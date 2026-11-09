#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Assistente de Migração Segura OneDrive -> Google Drive (Edição Zero-Erros)
- Compara pastas sem acionar download automático do OneDrive (Files On-Demand)
- Identifica arquivos já locais vs. apenas na nuvem
- Divide em lotes seguros (locais e nuvem)
- Cópia atômica (.sync_part) + flush físico (os.fsync) + verificação criptográfica SHA-256 bit a bit
- Retentativa automática (3x) contra oscilações de rede/OneDrive
- Backup automático caso exista arquivo com tamanho divergente no destino (nunca sobrescreve sem salvar)
- Trava de segurança de espaço livre em disco (mínimo 5 GB livres)
- Log de auditoria permanente em CSV (logs/auditoria_transferencias.csv)
- Cache persistente do relatório (atualiza instantaneamente após cada lote sem re-escanear o G: inteiro)
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Constantes de atributos de arquivo do Windows (NTFS / Cloud Files API)
FILE_ATTRIBUTE_HIDDEN = 0x00000002
FILE_ATTRIBUTE_SYSTEM = 0x00000004
FILE_ATTRIBUTE_OFFLINE = 0x00001000
FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x00040000
FILE_ATTRIBUTE_PINNED = 0x00080000
FILE_ATTRIBUTE_UNPINNED = 0x00100000
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x00400000

CLOUD_ONLY_MASK = (
    FILE_ATTRIBUTE_OFFLINE
    | FILE_ATTRIBUTE_RECALL_ON_OPEN
    | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
)

IGNORED_NAMES_DEFAULT = {
    "desktop.ini",
    "thumbs.db",
    ".ds_store",
}

IGNORED_SUFFIXES = (
    ".sync_part",
    ".tmp",
)

# Limite mínimo de espaço livre em disco (5 GB) para evitar travamento do cache do OneDrive/GDrive
MIN_FREE_DISK_BYTES = 5 * 1024 * 1024 * 1024
MAX_RETRY_ATTEMPTS = 3
RETRY_DELAYS_SEC = (2.0, 5.0, 10.0)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
LOGS_DIR = BASE_DIR / "logs"
AUDIT_CSV_PATH = LOGS_DIR / "auditoria_transferencias.csv"
REPORT_CACHE_PATH = BASE_DIR / "ultimo_relatorio_cache.json"


def to_long_path(path_str: str) -> str:
    """Converte caminho do Windows para suportar mais de 260 caracteres (\\\\?\\)."""
    if os.name != "nt":
        return path_str
    abs_path = os.path.abspath(path_str)
    if abs_path.startswith("\\\\?\\"):
        return abs_path
    if abs_path.startswith("\\\\"):
        return "\\\\?\\UNC\\" + abs_path[2:]
    return "\\\\?\\" + abs_path


def safe_gdrive_component(name: str, max_utf8_bytes: int = 245) -> str:
    """
    O driver do Google Drive para Desktop (G:\\) impõe um limite rígido de 255 bytes
    em UTF-8 por nome de arquivo (diferente do NTFS do Windows, que permite 255
    caracteres UTF-16). Como caracteres japoneses/CJK ocupam 3 bytes cada em UTF-8,
    nomes em japonês com mais de ~83 caracteres estouram 255 bytes UTF-8 e geram
    [Errno 22] Invalid argument no Google Drive.

    Esta função mantém intactos todos os nomes <= 245 bytes UTF-8 e, apenas para os
    que excederem esse limite, preserva o título inicial + sufixo único de 6 dígitos
    + extensão original dentro do limite de 245 bytes UTF-8.
    """
    if len(name.encode("utf-8")) <= max_utf8_bytes:
        return name

    stem, ext = os.path.splitext(name)
    ext_bytes = len(ext.encode("utf-8"))
    if ext_bytes > 40:
        stem = name
        ext = ""
        ext_bytes = 0

    short_hash = "_" + hashlib.sha256(name.encode("utf-8")).hexdigest()[:6]
    hash_bytes = len(short_hash.encode("utf-8"))
    allowed_stem_bytes = max(32, max_utf8_bytes - ext_bytes - hash_bytes)

    out_chars: List[str] = []
    used_bytes = 0
    for ch in stem:
        ch_b = len(ch.encode("utf-8"))
        if used_bytes + ch_b > allowed_stem_bytes:
            break
        out_chars.append(ch)
        used_bytes += ch_b

    return "".join(out_chars).rstrip() + short_hash + ext


def safe_gdrive_rel_path(rel_path: str) -> str:
    """Aplica safe_gdrive_component em cada parte do caminho relativo."""
    parts = rel_path.replace("\\", "/").split("/")
    safe_parts = [safe_gdrive_component(p) for p in parts]
    return "/".join(safe_parts)


def is_cloud_only(file_attributes: int) -> bool:
    """
    Retorna True se o arquivo no OneDrive estiver apenas na nuvem (desidratado)
    e exigir download ao ser lido. Não abre o arquivo, evitando disparar download.
    """
    return bool(file_attributes & CLOUD_ONLY_MASK)


def is_pinned_local(file_attributes: int) -> bool:
    """Retorna True se o arquivo estiver marcado como 'Sempre manter neste dispositivo'."""
    return bool(file_attributes & FILE_ATTRIBUTE_PINNED)


def detect_default_paths() -> Dict[str, str]:
    """Tenta detectar caminhos padrão do OneDrive e Google Drive no Windows."""
    user_profile = os.environ.get("USERPROFILE", "")
    onedrive_candidates = [
        os.environ.get("OneDrive", ""),
        os.environ.get("OneDriveConsumer", ""),
        os.environ.get("OneDriveCommercial", ""),
        os.path.join(user_profile, "OneDrive") if user_profile else "",
    ]
    source_default = ""
    for cand in onedrive_candidates:
        if cand and os.path.isdir(cand):
            source_default = cand
            break

    dest_default = ""
    for drive_letter in "GHIJKLMNOPQRSTUVWXYZDEF":
        for folder_name in ("Meu Drive", "My Drive"):
            candidate = f"{drive_letter}:\\{folder_name}"
            if os.path.isdir(candidate):
                dest_default = candidate
                break
        if dest_default:
            break

    if not dest_default and user_profile:
        for folder_name in ("Google Drive", "Meu Drive"):
            candidate = os.path.join(user_profile, folder_name)
            if os.path.isdir(candidate):
                dest_default = candidate
                break

    return {"source": source_default, "destination": dest_default}


def get_free_space_bytes(folder_path: str) -> Optional[int]:
    """Retorna bytes livres no disco da pasta informada."""
    try:
        usage = shutil.disk_usage(folder_path)
        return usage.free
    except OSError:
        return None


def append_audit_log(
    rel_path: str,
    size_bytes: int,
    src_sha256: str,
    dst_sha256: str,
    attempts: int,
    status: str,
    detail: str = "",
) -> None:
    """Registra cada transferência verificada em um arquivo CSV permanente de auditoria."""
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        file_exists = AUDIT_CSV_PATH.is_file()
        with open(AUDIT_CSV_PATH, "a", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f, delimiter=";")
            if not file_exists:
                writer.writerow([
                    "Data_Hora",
                    "Status_Auditoria",
                    "Caminho_Relativo",
                    "Tamanho_Bytes",
                    "SHA256_Origem",
                    "SHA256_Destino",
                    "Tentativas",
                    "Observacao",
                ])
            writer.writerow([
                time.strftime("%Y-%m-%d %H:%M:%S"),
                status,
                rel_path,
                size_bytes,
                src_sha256,
                dst_sha256,
                attempts,
                detail,
            ])
    except OSError:
        pass


class SyncState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        defaults = detect_default_paths()
        self.source_dir: str = defaults["source"]
        self.dest_dir: str = defaults["destination"]

        # Estado do escaneamento
        self.scan_running: bool = False
        self.scan_progress: Dict[str, Any] = {
            "phase": "idle",
            "message": "Aguardando análise.",
            "source_scanned": 0,
            "dest_scanned": 0,
            "error": None,
        }
        self.last_report: Optional[Dict[str, Any]] = None

        # Estado da transferência por lote
        self.transfer_running: bool = False
        self.transfer_cancel_requested: bool = False
        self.transfer_status: Dict[str, Any] = {
            "state": "idle",
            "total_files": 0,
            "completed_files": 0,
            "verified_sha256_files": 0,
            "failed_files": 0,
            "skipped_files": 0,
            "retried_files": 0,
            "total_bytes": 0,
            "transferred_bytes": 0,
            "current_file": "",
            "current_phase": "",
            "current_file_size": 0,
            "current_file_copied": 0,
            "speed_bps": 0.0,
            "eta_seconds": None,
            "started_at": None,
            "finished_at": None,
            "errors": [],
            "recent_completed": [],
        }


STATE = SyncState()


def assign_priority_and_batches(
    pending_files: List[Dict[str, Any]],
    folder_stats: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Ordena os arquivos pendentes na ordem recomendada de transferência:
    1. Arquivos que JÁ estão baixados localmente no disco (não exigem download do OneDrive),
       ordenados da subpasta mais leve para a mais pesada e do menor arquivo para o maior.
    2. Arquivos na nuvem em subpastas pequenas/leves e arquivos pequenos (< 10 MB).
    3. Arquivos médios (10 MB a 100 MB) na nuvem, agrupados por subpasta.
    4. Arquivos grandes (> 100 MB) na nuvem por último.
    """
    MB = 1024 * 1024

    for item in pending_files:
        size = item["size"]
        local_avail = item["local_available"]
        folder = item["folder"]
        f_pending_bytes = folder_stats.get(folder, {}).get("pending_bytes", size)

        if local_avail:
            stage = 1
            stage_label = "Fase 1: Já no disco local (Rápido, sem download)"
        elif size <= 10 * MB:
            stage = 2
            stage_label = "Fase 2: Nuvem - Pequenos (até 10 MB)"
        elif size <= 100 * MB:
            stage = 3
            stage_label = "Fase 3: Nuvem - Médios (10 MB a 100 MB)"
        else:
            stage = 4
            stage_label = "Fase 4: Nuvem - Grandes (> 100 MB)"

        item["stage"] = stage
        item["stage_label"] = stage_label
        item["folder_pending_bytes"] = f_pending_bytes

    pending_files.sort(
        key=lambda x: (
            x["stage"],
            x["folder_pending_bytes"],
            x["size"],
            x["rel_path"].lower(),
        )
    )

    for idx, item in enumerate(pending_files, start=1):
        item["order"] = idx

    return pending_files


def build_recommended_batches(pending_files: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Divide tanto os arquivos locais quanto os arquivos na nuvem em lotes seguros:
    - Arquivos já locais: lotes de até ~1 GB ou até 500 arquivos (para não saturar o cache de upload do Google Drive)
    - Arquivos na nuvem: lotes de até ~500 MB ou até 250 arquivos (para não saturar o download do OneDrive)
    """
    batches: List[Dict[str, Any]] = []
    if not pending_files:
        return batches

    # 1. Lotes Prioritários (Arquivos que já estão no disco local)
    local_files = [f for f in pending_files if f["local_available"]]
    MAX_LOCAL_BATCH_BYTES = 1024 * 1024 * 1024  # 1 GB por lote local
    MAX_LOCAL_BATCH_FILES = 500

    cur_local: List[Dict[str, Any]] = []
    cur_local_bytes = 0
    local_batch_num = 1

    for f in local_files:
        if cur_local and (
            cur_local_bytes + f["size"] > MAX_LOCAL_BATCH_BYTES
            or len(cur_local) >= MAX_LOCAL_BATCH_FILES
        ):
            batches.append(_format_batch_card(
                batch_id=f"batch_local_{local_batch_num}",
                title=f"Lote Local #{local_batch_num} (Itens #{cur_local[0]['order']} a #{cur_local[-1]['order']})",
                badge=f"Local #{local_batch_num} (Sem Download)",
                badge_type="success",
                files=cur_local,
                total_bytes=cur_local_bytes,
                is_local=True,
            ))
            local_batch_num += 1
            cur_local = []
            cur_local_bytes = 0

        cur_local.append(f)
        cur_local_bytes += f["size"]

    if cur_local:
        batches.append(_format_batch_card(
            batch_id=f"batch_local_{local_batch_num}",
            title=f"Lote Local #{local_batch_num} (Itens #{cur_local[0]['order']} a #{cur_local[-1]['order']})",
            badge=f"Local #{local_batch_num} (Sem Download)",
            badge_type="success",
            files=cur_local,
            total_bytes=cur_local_bytes,
            is_local=True,
        ))

    # 2. Lotes na Nuvem (Precisam baixar do OneDrive)
    cloud_files = [f for f in pending_files if not f["local_available"]]
    MAX_CLOUD_BATCH_BYTES = 500 * 1024 * 1024  # 500 MB por lote na nuvem
    MAX_CLOUD_BATCH_FILES = 250

    cur_cloud: List[Dict[str, Any]] = []
    cur_cloud_bytes = 0
    cloud_batch_num = 1

    for f in cloud_files:
        if cur_cloud and (
            cur_cloud_bytes + f["size"] > MAX_CLOUD_BATCH_BYTES
            or len(cur_cloud) >= MAX_CLOUD_BATCH_FILES
        ):
            batches.append(_format_batch_card(
                batch_id=f"batch_cloud_{cloud_batch_num}",
                title=f"Lote Nuvem #{cloud_batch_num} (Itens #{cur_cloud[0]['order']} a #{cur_cloud[-1]['order']})",
                badge=f"Nuvem #{cloud_batch_num}",
                badge_type="info",
                files=cur_cloud,
                total_bytes=cur_cloud_bytes,
                is_local=False,
            ))
            cloud_batch_num += 1
            cur_cloud = []
            cur_cloud_bytes = 0

        cur_cloud.append(f)
        cur_cloud_bytes += f["size"]

    if cur_cloud:
        batches.append(_format_batch_card(
            batch_id=f"batch_cloud_{cloud_batch_num}",
            title=f"Lote Nuvem #{cloud_batch_num} (Itens #{cur_cloud[0]['order']} a #{cur_cloud[-1]['order']})",
            badge=f"Nuvem #{cloud_batch_num}",
            badge_type="info",
            files=cur_cloud,
            total_bytes=cur_cloud_bytes,
            is_local=False,
        ))

    return batches


def _format_batch_card(
    batch_id: str,
    title: str,
    badge: str,
    badge_type: str,
    files: List[Dict[str, Any]],
    total_bytes: int,
    is_local: bool,
) -> Dict[str, Any]:
    # Agrupa por subpasta exata e por pasta raiz (1º nível)
    subfolder_map: Dict[str, Dict[str, Any]] = {}
    root_folder_map: Dict[str, Dict[str, Any]] = {}

    for f in files:
        folder = f["folder"]
        root_name = "(Raiz)" if folder == "." else folder.split("/")[0]

        if folder not in subfolder_map:
            subfolder_map[folder] = {"folder": folder, "count": 0, "bytes": 0}
        subfolder_map[folder]["count"] += 1
        subfolder_map[folder]["bytes"] += f["size"]

        if root_name not in root_folder_map:
            root_folder_map[root_name] = {"folder": root_name, "count": 0, "bytes": 0}
        root_folder_map[root_name]["count"] += 1
        root_folder_map[root_name]["bytes"] += f["size"]

    subfolders_list = sorted(subfolder_map.values(), key=lambda x: x["folder"].lower())
    root_folders_list = sorted(
        root_folder_map.values(), key=lambda x: (-x["bytes"], x["folder"].lower())
    )

    root_names = [r["folder"] for r in root_folders_list]
    if len(root_names) <= 3:
        roots_summary = "Pastas principais: " + ", ".join(root_names)
    else:
        roots_summary = (
            "Pastas principais: "
            + ", ".join(root_names[:3])
            + f" (+{len(root_names) - 3} outras)"
        )

    extra = (
        "Já disponível no disco local (não baixa do OneDrive). Verificação SHA-256 ativa."
        if is_local
        else "Download controlado do OneDrive + verificação SHA-256 bit a bit."
    )

    return {
        "id": batch_id,
        "title": title,
        "description": f"{roots_summary}. {extra}",
        "badge": badge,
        "badge_type": badge_type,
        "file_count": len(files),
        "total_bytes": total_bytes,
        "local_count": len(files) if is_local else 0,
        "cloud_count": 0 if is_local else len(files),
        "subfolder_count": len(subfolders_list),
        "root_folders": root_folders_list,
        "subfolders": subfolders_list,
        "rel_paths": [f["rel_path"] for f in files],
    }


def save_report_cache(report: Dict[str, Any]) -> None:
    """Salva o relatório em disco para carregamento imediato."""
    try:
        temp_file = REPORT_CACHE_PATH.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False)
        os.replace(temp_file, REPORT_CACHE_PATH)
    except OSError:
        pass


def load_report_cache_if_available() -> None:
    """Carrega o último relatório salvo em cache ao iniciar o servidor."""
    if not REPORT_CACHE_PATH.is_file():
        return
    try:
        with open(REPORT_CACHE_PATH, "r", encoding="utf-8") as f:
            report = json.load(f)
        # Re-gera os lotes caso a regra de divisão de lotes tenha sido aprimorada
        pending = report.get("pending_files", [])
        if pending:
            report["batches"] = build_recommended_batches(pending)
        with STATE.lock:
            STATE.last_report = report
            summary = report.get("summary", {})
            if summary.get("source_dir"):
                STATE.source_dir = summary["source_dir"]
            if summary.get("dest_dir"):
                STATE.dest_dir = summary["dest_dir"]
    except Exception:
        pass


def update_report_after_transfer(completed_rel_paths: set[str]) -> None:
    """
    Atualiza o relatório em memória e no cache instantaneamente após concluir um lote,
    sem exigir uma nova leitura demorada de todo o Google Drive.
    """
    if not completed_rel_paths:
        return

    with STATE.lock:
        report = STATE.last_report
        if not report:
            return

        pending_files = report.get("pending_files", [])
        synced_files = report.get("synced_files", [])

        remaining_pending: List[Dict[str, Any]] = []
        newly_synced: List[Dict[str, Any]] = []

        for item in pending_files:
            if item["rel_path"] in completed_rel_paths:
                item_copy = dict(item)
                item_copy["status"] = "synced"
                item_copy["status_label"] = "Transferido e Verificado (SHA-256 OK)"
                item_copy["reason"] = "Cópia verificada bit a bit com hash SHA-256."
                newly_synced.append(item_copy)
            else:
                remaining_pending.append(item)

        synced_files.extend(newly_synced)

        # Recalcula estatísticas por subpasta
        folder_stats: Dict[str, Dict[str, Any]] = {}
        for f in report.get("folders", []):
            folder_stats[f["folder"]] = {
                "folder": f["folder"],
                "total_files": f["total_files"],
                "synced_files": 0,
                "pending_files": 0,
                "local_pending_files": 0,
                "cloud_pending_files": 0,
                "total_bytes": f["total_bytes"],
                "synced_bytes": 0,
                "pending_bytes": 0,
            }

        for item in synced_files:
            fl = folder_stats.get(item["folder"])
            if fl:
                fl["synced_files"] += 1
                fl["synced_bytes"] += item["size"]

        for item in remaining_pending:
            fl = folder_stats.get(item["folder"])
            if fl:
                fl["pending_files"] += 1
                fl["pending_bytes"] += item["size"]
                if item["local_available"]:
                    fl["local_pending_files"] += 1
                else:
                    fl["cloud_pending_files"] += 1

        folders_list = list(folder_stats.values())
        for fl in folders_list:
            total_f = fl["total_files"]
            fl["completion_pct"] = round((fl["synced_files"] / total_f) * 100, 1) if total_f else 100.0

        folders_list.sort(
            key=lambda f: (
                0 if f["pending_files"] > 0 else 1,
                -f["local_pending_files"],
                f["pending_bytes"],
                f["folder"].lower(),
            )
        )

        remaining_pending = assign_priority_and_batches(remaining_pending, folder_stats)
        batches = build_recommended_batches(remaining_pending)

        summary = report["summary"]
        total_src_files = summary.get("total_source_files", len(synced_files) + len(remaining_pending))
        total_src_bytes = summary.get("total_source_bytes", 0)
        synced_bytes = sum(i["size"] for i in synced_files)
        pending_bytes = sum(i["size"] for i in remaining_pending)

        summary["synced_count"] = len(synced_files)
        summary["pending_count"] = len(remaining_pending)
        summary["missing_count"] = sum(1 for i in remaining_pending if i["status"] == "missing")
        summary["mismatch_count"] = sum(1 for i in remaining_pending if i["status"] == "mismatch")
        summary["local_pending_count"] = sum(1 for i in remaining_pending if i["local_available"])
        summary["cloud_pending_count"] = sum(1 for i in remaining_pending if not i["local_available"])
        summary["synced_bytes"] = synced_bytes
        summary["pending_bytes"] = pending_bytes
        summary["local_pending_bytes"] = sum(i["size"] for i in remaining_pending if i["local_available"])
        summary["cloud_pending_bytes"] = sum(i["size"] for i in remaining_pending if not i["local_available"])
        summary["completion_files_pct"] = (
            round((len(synced_files) / total_src_files) * 100, 1) if total_src_files else 100.0
        )
        summary["completion_bytes_pct"] = (
            round((synced_bytes / total_src_bytes) * 100, 1) if total_src_bytes else 100.0
        )

        report["pending_files"] = remaining_pending
        report["synced_files"] = synced_files
        report["folders"] = folders_list
        report["batches"] = batches

    save_report_cache(report)


def scan_tree_metadata(
    root_dir: str,
    ignore_system: bool,
    counter_key: str,
) -> Dict[str, Dict[str, Any]]:
    """
    Percorre a árvore de diretórios usando os.scandir() sem abrir nenhum arquivo.
    """
    results: Dict[str, Dict[str, Any]] = {}
    long_root = to_long_path(root_dir)
    stack: List[str] = [long_root]
    count = 0

    while stack:
        current_dir = stack.pop()
        try:
            with os.scandir(current_dir) as it:
                for entry in it:
                    name = entry.name
                    name_lower = name.lower()

                    if (
                        name_lower in IGNORED_NAMES_DEFAULT
                        or name_lower.endswith(IGNORED_SUFFIXES)
                        or name == "_Backup_Versoes_Conflito"
                    ):
                        continue

                    try:
                        st = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue

                    attrs = getattr(st, "st_file_attributes", 0)
                    if ignore_system and (attrs & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)):
                        continue

                    try:
                        is_dir = entry.is_dir(follow_symlinks=False)
                    except OSError:
                        continue

                    if is_dir:
                        stack.append(entry.path)
                    else:
                        rel_path = os.path.relpath(entry.path, long_root)
                        rel_norm = rel_path.replace("\\", "/")
                        folder_rel = os.path.dirname(rel_norm) or "."

                        cloud_only = is_cloud_only(attrs)
                        pinned = is_pinned_local(attrs)

                        results[rel_norm] = {
                            "rel_path": rel_norm,
                            "name": name,
                            "folder": folder_rel,
                            "size": st.st_size,
                            "mtime": st.st_mtime,
                            "cloud_only": cloud_only,
                            "local_available": not cloud_only,
                            "pinned": pinned,
                        }
                        count += 1
                        if count % 200 == 0:
                            with STATE.lock:
                                STATE.scan_progress[counter_key] = count
        except OSError:
            continue

    with STATE.lock:
        STATE.scan_progress[counter_key] = count

    return results


def run_comparison_job(source_dir: str, dest_dir: str, ignore_system: bool = True) -> None:
    try:
        with STATE.lock:
            STATE.scan_running = True
            STATE.scan_progress = {
                "phase": "scanning_source",
                "message": "Lendo metadados da pasta de origem (OneDrive) sem baixar arquivos...",
                "source_scanned": 0,
                "dest_scanned": 0,
                "error": None,
            }

        src_map = scan_tree_metadata(source_dir, ignore_system, "source_scanned")

        with STATE.lock:
            STATE.scan_progress["phase"] = "scanning_dest"
            STATE.scan_progress["message"] = "Lendo metadados da pasta de destino (Google Drive)..."

        dst_map = scan_tree_metadata(dest_dir, ignore_system, "dest_scanned")

        with STATE.lock:
            STATE.scan_progress["phase"] = "comparing"
            STATE.scan_progress["message"] = "Calculando diferenças e gerando lotes seguros..."

        pending_files: List[Dict[str, Any]] = []
        synced_files: List[Dict[str, Any]] = []
        extra_dest_files: List[Dict[str, Any]] = []
        folder_stats: Dict[str, Dict[str, Any]] = {}

        dst_norm_map: Dict[str, Dict[str, Any]] = {
            unicodedata.normalize("NFC", k).lower(): v for k, v in dst_map.items()
        }

        for rel_path, src_info in src_map.items():
            folder = src_info["folder"]
            if folder not in folder_stats:
                folder_stats[folder] = {
                    "folder": folder,
                    "total_files": 0,
                    "synced_files": 0,
                    "pending_files": 0,
                    "local_pending_files": 0,
                    "cloud_pending_files": 0,
                    "total_bytes": 0,
                    "synced_bytes": 0,
                    "pending_bytes": 0,
                }

            fstat = folder_stats[folder]
            fstat["total_files"] += 1
            fstat["total_bytes"] += src_info["size"]

            dst_info = dst_map.get(rel_path)
            if dst_info is None:
                norm_key = unicodedata.normalize("NFC", rel_path).lower()
                dst_info = dst_norm_map.get(norm_key)
            if dst_info is None:
                safe_rel = safe_gdrive_rel_path(rel_path)
                if safe_rel != rel_path:
                    dst_info = dst_map.get(safe_rel)
                    if dst_info is None:
                        safe_norm_key = unicodedata.normalize("NFC", safe_rel).lower()
                        dst_info = dst_norm_map.get(safe_norm_key)
            if dst_info is None and not os.path.splitext(src_info["name"])[1]:
                # O Google Drive para Desktop adiciona automaticamente a extensão (ex.: .pdf)
                # em arquivos sem extensão após inspecionar o cabeçalho MIME do arquivo.
                base_norm = unicodedata.normalize("NFC", rel_path).lower()
                for auto_ext in (".pdf", ".docx", ".xlsx", ".pptx", ".jpg", ".png", ".txt", ".zip"):
                    cand = dst_norm_map.get(base_norm + auto_ext)
                    if cand is not None and cand["size"] == src_info["size"]:
                        dst_info = cand
                        break

            if dst_info is None:
                status = "missing"
                status_label = "Faltando no destino"
                reason = "Arquivo ainda não existe no Google Drive."
            elif dst_info["size"] != src_info["size"]:
                status = "mismatch"
                status_label = "Incompleto / Tamanho diferente"
                reason = (
                    f"Tamanho no OneDrive ({src_info['size']} B) difere do "
                    f"Google Drive ({dst_info['size']} B)."
                )
            else:
                status = "synced"
                status_label = "Transferido (OK)"
                reason = "Arquivo presente no destino com mesmo tamanho."

            entry = {
                **src_info,
                "status": status,
                "status_label": status_label,
                "reason": reason,
                "dest_size": dst_info["size"] if dst_info else None,
                "dest_mtime": dst_info["mtime"] if dst_info else None,
            }

            if status == "synced":
                synced_files.append(entry)
                fstat["synced_files"] += 1
                fstat["synced_bytes"] += src_info["size"]
            else:
                pending_files.append(entry)
                fstat["pending_files"] += 1
                fstat["pending_bytes"] += src_info["size"]
                if src_info["local_available"]:
                    fstat["local_pending_files"] += 1
                else:
                    fstat["cloud_pending_files"] += 1

        for rel_path, dst_info in dst_map.items():
            if rel_path not in src_map:
                extra_dest_files.append({
                    **dst_info,
                    "status": "extra_dest",
                    "status_label": "Apenas no Google Drive",
                    "reason": "Existe no Google Drive, mas não está na pasta do OneDrive.",
                })

        pending_files = assign_priority_and_batches(pending_files, folder_stats)
        batches = build_recommended_batches(pending_files)

        folders_list = list(folder_stats.values())
        for fl in folders_list:
            total_f = fl["total_files"]
            fl["completion_pct"] = round((fl["synced_files"] / total_f) * 100, 1) if total_f else 100.0

        folders_list.sort(
            key=lambda f: (
                0 if f["pending_files"] > 0 else 1,
                -f["local_pending_files"],
                f["pending_bytes"],
                f["folder"].lower(),
            )
        )

        total_src_bytes = sum(i["size"] for i in src_map.values())
        synced_bytes = sum(i["size"] for i in synced_files)
        pending_bytes = sum(i["size"] for i in pending_files)
        local_pending_bytes = sum(i["size"] for i in pending_files if i["local_available"])
        cloud_pending_bytes = sum(i["size"] for i in pending_files if not i["local_available"])

        summary = {
            "source_dir": source_dir,
            "dest_dir": dest_dir,
            "scanned_at": time.strftime("%d/%m/%Y %H:%M:%S"),
            "total_source_files": len(src_map),
            "total_dest_files": len(dst_map),
            "synced_count": len(synced_files),
            "pending_count": len(pending_files),
            "missing_count": sum(1 for i in pending_files if i["status"] == "missing"),
            "mismatch_count": sum(1 for i in pending_files if i["status"] == "mismatch"),
            "extra_dest_count": len(extra_dest_files),
            "local_pending_count": sum(1 for i in pending_files if i["local_available"]),
            "cloud_pending_count": sum(1 for i in pending_files if not i["local_available"]),
            "synced_local_still_taking_space_count": sum(
                1 for i in synced_files if i["local_available"] and not i["pinned"]
            ),
            "synced_local_still_taking_space_bytes": sum(
                i["size"] for i in synced_files if i["local_available"] and not i["pinned"]
            ),
            "total_source_bytes": total_src_bytes,
            "synced_bytes": synced_bytes,
            "pending_bytes": pending_bytes,
            "local_pending_bytes": local_pending_bytes,
            "cloud_pending_bytes": cloud_pending_bytes,
            "completion_files_pct": (
                round((len(synced_files) / len(src_map)) * 100, 1) if src_map else 100.0
            ),
            "completion_bytes_pct": (
                round((synced_bytes / total_src_bytes) * 100, 1) if total_src_bytes else 100.0
            ),
        }

        report = {
            "summary": summary,
            "batches": batches,
            "folders": folders_list,
            "pending_files": pending_files,
            "synced_files": synced_files,
            "extra_dest_files": extra_dest_files,
        }

        save_report_cache(report)

        with STATE.lock:
            STATE.last_report = report
            STATE.scan_running = False
            STATE.scan_progress = {
                "phase": "completed",
                "message": "Análise concluída com sucesso.",
                "source_scanned": len(src_map),
                "dest_scanned": len(dst_map),
                "error": None,
            }

    except Exception as exc:
        with STATE.lock:
            STATE.scan_running = False
            STATE.scan_progress = {
                "phase": "error",
                "message": f"Erro ao analisar pastas: {exc}",
                "source_scanned": STATE.scan_progress.get("source_scanned", 0),
                "dest_scanned": STATE.scan_progress.get("dest_scanned", 0),
                "error": str(exc),
            }


def backup_existing_conflict_file(dest_root: str, rel_path: str, long_dst: str) -> Optional[str]:
    """
    Se já existir um arquivo no destino com tamanho diferente, nunca o apaga nem
    sobrescreve diretamente: move-o para a pasta _Backup_Versoes_Conflito no destino.
    """
    if not os.path.exists(long_dst):
        return None
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    norm_rel = rel_path.replace("/", os.sep)
    backup_rel = os.path.join("_Backup_Versoes_Conflito", timestamp, norm_rel)
    backup_full = to_long_path(os.path.join(dest_root, backup_rel))
    os.makedirs(os.path.dirname(backup_full), exist_ok=True)
    shutil.move(long_dst, backup_full)
    return backup_rel


def copy_and_verify_sha256(
    src_path: str,
    dst_path: str,
    dest_root: str,
    rel_path: str,
    expected_size: int,
    chunk_size: int = 1024 * 1024,
) -> Tuple[int, str, str]:
    """
    Realiza a cópia com máxima segurança (Zero-Erros):
    1. Lê da origem calculando o hash criptográfico SHA-256 em tempo real.
    2. Grava em arquivo temporário (.sync_part) e força a gravação física no disco (os.fsync).
    3. Reabre o arquivo gravado no destino e recalcula o hash SHA-256 a partir do destino.
    4. Compara tamanho exato + SHA-256 de origem vs. SHA-256 de destino bit a bit.
    5. Se já havia arquivo conflitante no destino, salva backup antes de renomear.
    6. Renomeia atomicamente (.sync_part -> nome final).
    """
    long_src = to_long_path(src_path)
    long_dst = to_long_path(dst_path)
    dst_parent = os.path.dirname(long_dst)
    os.makedirs(dst_parent, exist_ok=True)

    # Usa nome temporário curto (.sync_tmp_<hash>.sync_part) para nunca exceder o limite de 255 bytes UTF-8 do Google Drive
    path_tag = hashlib.sha256(rel_path.encode("utf-8")).hexdigest()[:12]
    temp_dst = os.path.join(dst_parent, f".sync_tmp_{path_tag}.sync_part")
    copied = 0
    src_hasher = hashlib.sha256()

    try:
        with STATE.lock:
            STATE.transfer_status["current_phase"] = "Copiando e calculando SHA-256..."

        with open(long_src, "rb") as fsrc, open(temp_dst, "wb") as fdst:
            while True:
                with STATE.lock:
                    if STATE.transfer_cancel_requested:
                        raise InterruptedError("Transferência interrompida pelo usuário.")

                buf = fsrc.read(chunk_size)
                if not buf:
                    break
                src_hasher.update(buf)
                fdst.write(buf)
                copied += len(buf)

                with STATE.lock:
                    STATE.transfer_status["current_file_copied"] = copied

            fdst.flush()
            try:
                os.fsync(fdst.fileno())
            except OSError:
                pass

        src_sha256 = src_hasher.hexdigest()

        # Preserva metadados de data/hora originais
        try:
            shutil.copystat(long_src, temp_dst, follow_symlinks=False)
        except OSError:
            pass

        # Fase 2: Verificação de leitura real no destino (bit a bit)
        with STATE.lock:
            STATE.transfer_status["current_phase"] = "Verificando integridade SHA-256 no destino..."

        actual_size = os.path.getsize(temp_dst)
        if actual_size != expected_size:
            raise IOError(
                f"Falha de tamanho: origem tem {expected_size} B, mas destino gravou {actual_size} B."
            )

        dst_hasher = hashlib.sha256()
        with open(temp_dst, "rb") as fverify:
            while True:
                with STATE.lock:
                    if STATE.transfer_cancel_requested:
                        raise InterruptedError("Transferência interrompida pelo usuário.")
                vbuf = fverify.read(chunk_size)
                if not vbuf:
                    break
                dst_hasher.update(vbuf)

        dst_sha256 = dst_hasher.hexdigest()
        if dst_sha256 != src_sha256:
            raise IOError(
                f"Falha na verificação criptográfica SHA-256! "
                f"Origem ({src_sha256[:12]}...) != Destino ({dst_sha256[:12]}...)"
            )

        # Se existir um arquivo diferente no destino, move para pasta de backup antes de substituir
        if os.path.exists(long_dst):
            backup_existing_conflict_file(dest_root, rel_path, long_dst)

        os.replace(temp_dst, long_dst)
        return copied, src_sha256, dst_sha256

    except BaseException:
        if os.path.exists(temp_dst):
            try:
                os.remove(temp_dst)
            except OSError:
                pass
        raise


def run_transfer_job(
    source_dir: str,
    dest_dir: str,
    rel_paths: List[str],
    dehydrate_after_copy: bool = False,
) -> None:
    """Executa a transferência verificada de uma lista de arquivos com retentativa e log de auditoria."""
    start_time = time.time()

    size_lookup: Dict[str, int] = {}
    with STATE.lock:
        if STATE.last_report:
            for item in STATE.last_report.get("pending_files", []):
                size_lookup[item["rel_path"]] = item["size"]

    total_bytes = sum(size_lookup.get(p, 0) for p in rel_paths)
    completed_set: set[str] = set()

    with STATE.lock:
        STATE.transfer_running = True
        STATE.transfer_cancel_requested = False
        STATE.transfer_status = {
            "state": "running",
            "total_files": len(rel_paths),
            "completed_files": 0,
            "verified_sha256_files": 0,
            "failed_files": 0,
            "skipped_files": 0,
            "retried_files": 0,
            "total_bytes": total_bytes,
            "transferred_bytes": 0,
            "current_file": "",
            "current_phase": "Iniciando lote...",
            "current_file_size": 0,
            "current_file_copied": 0,
            "speed_bps": 0.0,
            "eta_seconds": None,
            "started_at": time.strftime("%H:%M:%S"),
            "finished_at": None,
            "errors": [],
            "recent_completed": [],
        }

    for rel_path in rel_paths:
        with STATE.lock:
            if STATE.transfer_cancel_requested:
                STATE.transfer_status["state"] = "cancelled"
                break

        # Guardião de espaço em disco antes de cada arquivo
        src_free = get_free_space_bytes(source_dir)
        dst_free = get_free_space_bytes(dest_dir)
        if (src_free is not None and src_free < MIN_FREE_DISK_BYTES) or (
            dst_free is not None and dst_free < MIN_FREE_DISK_BYTES
        ):
            with STATE.lock:
                STATE.transfer_status["state"] = "error"
                STATE.transfer_status["errors"].append({
                    "rel_path": rel_path,
                    "error": (
                        "Pausa preventiva de segurança: o espaço livre em disco caiu abaixo de 5 GB. "
                        "Aguarde o Google Drive concluir o upload do cache ou libere espaço antes de continuar."
                    ),
                })
            break

        norm_rel = rel_path.replace("/", os.sep)
        safe_rel = safe_gdrive_rel_path(rel_path)
        norm_safe_rel = safe_rel.replace("/", os.sep)
        src_full = os.path.join(source_dir, norm_rel)
        dst_full = os.path.join(dest_dir, norm_safe_rel)
        was_name_shortened = safe_rel != rel_path

        try:
            src_stat = os.stat(to_long_path(src_full))
            expected_size = src_stat.st_size
        except OSError as exc:
            with STATE.lock:
                STATE.transfer_status["failed_files"] += 1
                STATE.transfer_status["errors"].append({
                    "rel_path": rel_path,
                    "error": f"Arquivo de origem inacessível: {exc}",
                })
            append_audit_log(rel_path, 0, "", "", 1, "ERRO_ORIGEM", str(exc))
            continue

        # Se já existe no destino com o mesmo tamanho exato, pula sem regravar
        try:
            dst_stat = os.stat(to_long_path(dst_full))
            if dst_stat.st_size == expected_size:
                completed_set.add(rel_path)
                with STATE.lock:
                    STATE.transfer_status["skipped_files"] += 1
                    STATE.transfer_status["completed_files"] += 1
                    STATE.transfer_status["transferred_bytes"] += expected_size
                continue
        except OSError:
            pass

        with STATE.lock:
            STATE.transfer_status["current_file"] = rel_path
            STATE.transfer_status["current_file_size"] = expected_size
            STATE.transfer_status["current_file_copied"] = 0

        last_err: Optional[Exception] = None
        succeeded = False

        for attempt in range(1, MAX_RETRY_ATTEMPTS + 1):
            try:
                copied_bytes, src_hash, dst_hash = copy_and_verify_sha256(
                    src_full, dst_full, dest_dir, rel_path, expected_size
                )
                succeeded = True
                completed_set.add(rel_path)

                audit_note = (
                    f"Integridade bit a bit confirmada. Nome ajustado para limite de 255 bytes UTF-8 do GDrive: {safe_rel}"
                    if was_name_shortened
                    else "Integridade bit a bit confirmada."
                )
                append_audit_log(
                    rel_path=rel_path,
                    size_bytes=copied_bytes,
                    src_sha256=src_hash,
                    dst_sha256=dst_hash,
                    attempts=attempt,
                    status="VERIFICADO_SHA256_OK",
                    detail=audit_note,
                )

                if dehydrate_after_copy and os.name == "nt":
                    try:
                        subprocess.run(
                            ["attrib", "+U", "-P", src_full],
                            capture_output=True,
                            timeout=10,
                            check=False,
                        )
                    except Exception:
                        pass

                elapsed = max(time.time() - start_time, 0.001)
                with STATE.lock:
                    STATE.transfer_status["completed_files"] += 1
                    STATE.transfer_status["verified_sha256_files"] += 1
                    STATE.transfer_status["transferred_bytes"] += copied_bytes
                    done_bytes = STATE.transfer_status["transferred_bytes"]
                    speed = done_bytes / elapsed
                    STATE.transfer_status["speed_bps"] = speed
                    remaining_bytes = max(total_bytes - done_bytes, 0)
                    STATE.transfer_status["eta_seconds"] = (
                        int(remaining_bytes / speed) if speed > 0 else None
                    )
                    recent = STATE.transfer_status["recent_completed"]
                    recent.insert(0, {
                        "rel_path": rel_path,
                        "size": copied_bytes,
                        "sha256": dst_hash[:16] + "...",
                    })
                    if len(recent) > 15:
                        recent.pop()
                break

            except InterruptedError:
                with STATE.lock:
                    STATE.transfer_status["state"] = "cancelled"
                last_err = None
                break
            except Exception as exc:
                last_err = exc
                if attempt < MAX_RETRY_ATTEMPTS:
                    with STATE.lock:
                        STATE.transfer_status["retried_files"] += 1
                        STATE.transfer_status["current_phase"] = (
                            f"Tentativa {attempt}/{MAX_RETRY_ATTEMPTS} falhou ({exc}). "
                            f"Aguardando {RETRY_DELAYS_SEC[attempt - 1]:.0f}s para tentar novamente..."
                        )
                    time.sleep(RETRY_DELAYS_SEC[attempt - 1])

        with STATE.lock:
            if STATE.transfer_status["state"] == "cancelled":
                break

        if not succeeded and last_err is not None:
            append_audit_log(
                rel_path=rel_path,
                size_bytes=expected_size,
                src_sha256="",
                dst_sha256="",
                attempts=MAX_RETRY_ATTEMPTS,
                status="FALHA_APOS_RETENTATIVAS",
                detail=str(last_err),
            )
            with STATE.lock:
                STATE.transfer_status["failed_files"] += 1
                STATE.transfer_status["errors"].append({
                    "rel_path": rel_path,
                    "error": f"Falhou após {MAX_RETRY_ATTEMPTS} tentativas: {last_err}",
                })

    # Atualiza instantaneamente o relatório e o cache com os arquivos já verificados
    update_report_after_transfer(completed_set)

    with STATE.lock:
        if STATE.transfer_status["state"] == "running":
            STATE.transfer_status["state"] = "completed"
        STATE.transfer_status["current_file"] = ""
        STATE.transfer_status["current_phase"] = "Lote finalizado."
        STATE.transfer_status["current_file_copied"] = 0
        STATE.transfer_status["finished_at"] = time.strftime("%H:%M:%S")
        STATE.transfer_running = False


def free_onedrive_space_for_synced(source_dir: str, dest_dir: str) -> Dict[str, Any]:
    """
    Marca como 'Apenas online' (attrib +U -P) no OneDrive APENAS os arquivos que
    comprovadamente já existem no Google Drive com o mesmo tamanho exato.
    """
    with STATE.lock:
        report = STATE.last_report

    if not report:
        return {"ok": False, "error": "Execute uma análise antes de liberar espaço."}

    freed_count = 0
    freed_bytes = 0
    errors: List[str] = []

    for item in report.get("synced_files", []):
        if not item.get("local_available") or item.get("pinned"):
            continue
        rel_path = item["rel_path"]
        norm_rel = rel_path.replace("/", os.sep)
        safe_rel = safe_gdrive_rel_path(rel_path)
        norm_safe_rel = safe_rel.replace("/", os.sep)
        src_full = os.path.join(source_dir, norm_rel)
        dst_full = os.path.join(dest_dir, norm_safe_rel)
        was_name_shortened = safe_rel != rel_path

        try:
            s_stat = os.stat(to_long_path(src_full))
            d_stat = os.stat(to_long_path(dst_full))
            if s_stat.st_size == d_stat.st_size:
                res = subprocess.run(
                    ["attrib", "+U", "-P", src_full],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=False,
                )
                if res.returncode == 0:
                    freed_count += 1
                    freed_bytes += s_stat.st_size
                    item["local_available"] = False
                    item["cloud_only"] = True
                else:
                    errors.append(f"{rel_path}: {res.stderr.strip() or 'Falha no attrib'}")
        except OSError as exc:
            errors.append(f"{rel_path}: {exc}")

    with STATE.lock:
        if STATE.last_report:
            s = STATE.last_report["summary"]
            synced_list = STATE.last_report.get("synced_files", [])
            s["synced_local_still_taking_space_count"] = sum(
                1 for i in synced_list if i.get("local_available") and not i.get("pinned")
            )
            s["synced_local_still_taking_space_bytes"] = sum(
                i["size"] for i in synced_list if i.get("local_available") and not i.get("pinned")
            )
            save_report_cache(STATE.last_report)

    return {
        "ok": True,
        "freed_count": freed_count,
        "freed_bytes": freed_bytes,
        "errors": errors[:20],
    }


def pick_folder_dialog(title: str, initial_dir: str = "") -> str:
    """Abre janela nativa do Windows para selecionar pasta."""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(
            title=title,
            initialdir=initial_dir if initial_dir and os.path.isdir(initial_dir) else None,
        )
        root.destroy()
        return os.path.normpath(selected) if selected else ""
    except Exception:
        return ""


class RequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _send_json(self, data: Any, status: int = 200) -> None:
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        body = self.rfile.read(length)
        return json.loads(body.decode("utf-8"))

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/defaults":
            with STATE.lock:
                src = STATE.source_dir
                dst = STATE.dest_dir
                scan_run = STATE.scan_running
                tx_run = STATE.transfer_running
            self._send_json({
                "source": src,
                "destination": dst,
                "scan_running": scan_run,
                "transfer_running": tx_run,
                "source_free_bytes": get_free_space_bytes(src) if src else None,
                "dest_free_bytes": get_free_space_bytes(dst) if dst else None,
                "audit_log_path": str(AUDIT_CSV_PATH),
            })
            return

        if path == "/api/scan/status":
            with STATE.lock:
                self._send_json({
                    "running": STATE.scan_running,
                    "progress": STATE.scan_progress,
                    "has_report": STATE.last_report is not None,
                })
            return

        if path == "/api/report":
            with STATE.lock:
                if STATE.last_report is None:
                    self._send_json({"error": "Nenhum relatório disponível ainda."}, status=404)
                else:
                    self._send_json(STATE.last_report)
            return

        if path == "/api/transfer/status":
            with STATE.lock:
                self._send_json({
                    "running": STATE.transfer_running,
                    "status": STATE.transfer_status,
                })
            return

        if path == "/api/export/csv":
            with STATE.lock:
                report = STATE.last_report
            if not report:
                self._send_json({"error": "Sem relatório para exportar."}, status=404)
                return

            output = io.StringIO()
            output.write("\ufeff")
            writer = csv.writer(output, delimiter=";")
            writer.writerow([
                "Ordem_Sugerida",
                "Fase_Prioridade",
                "Status",
                "Disponibilidade_OneDrive",
                "Subpasta",
                "Arquivo",
                "Caminho_Relativo",
                "Tamanho_Bytes",
                "Motivo",
            ])
            for item in report.get("pending_files", []):
                writer.writerow([
                    item.get("order", ""),
                    item.get("stage_label", ""),
                    item.get("status_label", ""),
                    "Local (No Disco)" if item.get("local_available") else "Apenas na Nuvem",
                    item.get("folder", ""),
                    item.get("name", ""),
                    item.get("rel_path", ""),
                    item.get("size", 0),
                    item.get("reason", ""),
                ])

            csv_bytes = output.getvalue().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header(
                "Content-Disposition",
                'attachment; filename="plano_transferencia_onedrive_gdrive.csv"',
            )
            self.send_header("Content-Length", str(len(csv_bytes)))
            self.end_headers()
            self.wfile.write(csv_bytes)
            return

        if path == "/api/export/audit":
            if not AUDIT_CSV_PATH.is_file():
                self._send_json({"error": "Nenhuma transferência auditada ainda."}, status=404)
                return
            data = AUDIT_CSV_PATH.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header(
                "Content-Disposition",
                'attachment; filename="auditoria_transferencias_sha256.csv"',
            )
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        # Servir arquivos estáticos (aceita /, /migracao, /index.html)
        if path in ("/", "/index.html", "/migracao", "/migracao/"):
            file_path = STATIC_DIR / "index.html"
            content_type = "text/html; charset=utf-8"
        elif path in ("/styles.css", "/migracao/styles.css"):
            file_path = STATIC_DIR / "styles.css"
            content_type = "text/css; charset=utf-8"
        elif path in ("/app.js", "/migracao/app.js"):
            file_path = STATIC_DIR / "app.js"
            content_type = "application/javascript; charset=utf-8"
        elif path in ("/logo.png", "/migracao/logo.png"):
            file_path = STATIC_DIR / "logo.png"
            content_type = "image/png"
        else:
            self.send_error(404, "Arquivo não encontrado")
            return

        if not file_path.is_file():
            self.send_error(404, "Arquivo estático não encontrado")
            return

        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()

        if path == "/api/pick-folder":
            role = body.get("role", "source")
            current = body.get("current", "")
            title = (
                "Selecione a pasta de ORIGEM (OneDrive)"
                if role == "source"
                else "Selecione a pasta de DESTINO (Google Drive)"
            )
            chosen = pick_folder_dialog(title, current)
            self._send_json({"selected": chosen})
            return

        if path == "/api/scan/start":
            with STATE.lock:
                if STATE.scan_running:
                    self._send_json({"error": "Uma análise já está em andamento."}, status=409)
                    return

            source_dir = os.path.normpath(body.get("source", "").strip())
            dest_dir = os.path.normpath(body.get("destination", "").strip())
            ignore_system = bool(body.get("ignore_system", True))

            if not source_dir or not os.path.isdir(to_long_path(source_dir)):
                self._send_json(
                    {"error": f"Pasta de origem inválida ou não encontrada: {source_dir}"},
                    status=400,
                )
                return

            if not dest_dir or not os.path.isdir(to_long_path(dest_dir)):
                self._send_json(
                    {"error": f"Pasta de destino inválida ou não encontrada: {dest_dir}"},
                    status=400,
                )
                return

            with STATE.lock:
                STATE.source_dir = source_dir
                STATE.dest_dir = dest_dir

            t = threading.Thread(
                target=run_comparison_job,
                args=(source_dir, dest_dir, ignore_system),
                daemon=True,
            )
            t.start()
            self._send_json({"ok": True})
            return

        if path == "/api/transfer/start":
            with STATE.lock:
                if STATE.transfer_running:
                    self._send_json(
                        {"error": "Uma transferência já está em andamento."},
                        status=409,
                    )
                    return
                source_dir = STATE.source_dir
                dest_dir = STATE.dest_dir

            rel_paths = body.get("rel_paths", [])
            dehydrate_after = bool(body.get("dehydrate_after_copy", False))

            if not rel_paths or not isinstance(rel_paths, list):
                self._send_json(
                    {"error": "Nenhum arquivo selecionado para transferência."},
                    status=400,
                )
                return

            t = threading.Thread(
                target=run_transfer_job,
                args=(source_dir, dest_dir, rel_paths, dehydrate_after),
                daemon=True,
            )
            t.start()
            self._send_json({"ok": True, "queued": len(rel_paths)})
            return

        if path == "/api/transfer/cancel":
            with STATE.lock:
                if STATE.transfer_running:
                    STATE.transfer_cancel_requested = True
            self._send_json({"ok": True})
            return

        if path == "/api/onedrive/free-space":
            with STATE.lock:
                source_dir = STATE.source_dir
                dest_dir = STATE.dest_dir
            result = free_onedrive_space_for_synced(source_dir, dest_dir)
            self._send_json(result, status=200 if result.get("ok") else 400)
            return

        self._send_json({"error": "Rota não encontrada."}, status=404)


class ExclusiveThreadingHTTPServer(ThreadingHTTPServer):
    """
    Impede que o Windows compartilhe a mesma porta TCP com outro programa já aberto
    (usando SO_EXCLUSIVEADDRUSE no Windows e allow_reuse_address = False).
    """

    allow_reuse_address = False

    def server_bind(self) -> None:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            try:
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            except OSError:
                pass
        super().server_bind()


def is_port_already_listening(port: int) -> bool:
    """Verifica se algum outro serviço já está respondendo nesta porta."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.15)
        return s.connect_ex(("127.0.0.1", port)) == 0


def main() -> None:
    load_report_cache_if_available()

    port = 19845
    server = None
    for candidate_port in range(19845, 19890):
        if is_port_already_listening(candidate_port):
            continue
        try:
            server = ExclusiveThreadingHTTPServer(("127.0.0.1", candidate_port), RequestHandler)
            port = candidate_port
            break
        except OSError:
            continue

    if server is None:
        print("Erro: Não foi possível iniciar o servidor local nas portas 19845-19889.")
        sys.exit(1)

    url = f"http://127.0.0.1:{port}/migracao"
    print("=" * 68)
    print(" ASSISTENTE DE MIGRAÇÃO ONEDRIVE -> GOOGLE DRIVE (EDIÇÃO ZERO-ERROS)")
    print("=" * 68)
    print(f" Painel interativo disponível em: {url}")
    print(" (Pressione Ctrl+C nesta janela para encerrar o assistente)")
    print("=" * 68)

    if "--no-browser" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando o assistente...")
        server.server_close()


if __name__ == "__main__":
    main()
