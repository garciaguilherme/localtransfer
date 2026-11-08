/**
 * Local Transfer: OneDrive -> Google Drive
 * Interactive frontend logic (WCAG 2.1 AA Accessible + Bilingual PT / EN)
 */

(() => {
  "use strict";

  const PAGE_SIZE = 100;

  let currentLang = localStorage.getItem("lt_ui_lang") === "en" ? "en" : "pt";
  let currentReport = null;
  let filteredPending = [];
  let queuePage = 1;
  let scanPollTimer = null;
  let transferPollTimer = null;
  let selectedBatchIndices = new Set();

  const I18N = {
    pt: {
      html_lang: "pt-BR",
      locale: "pt-BR",
      skip_link: "Pular para o conteúdo principal",
      subtitle_html:
        "Compara as duas pastas <strong>sem disparar downloads no OneDrive</strong>, identifica o que já está no disco local e sugere a melhor ordem de transferência por lotes.",
      export_audit_btn: "Baixar Log de Auditoria (SHA-256)",
      export_csv_btn: "Exportar Plano (CSV)",
      folders_heading: "1. Selecionar Pastas para Comparação",
      folders_desc:
        "Informe ou selecione a pasta de origem (OneDrive) e a pasta de destino (Google Drive). A leitura usa apenas metadados do sistema de arquivos.",
      source_label_html:
        'Pasta de Origem (OneDrive) <span class="required-tag" aria-hidden="true">*</span>',
      source_placeholder: "Ex: C:\\Users\\SeuNome\\OneDrive\\Documentos",
      source_help: "Caminho local da pasta sincronizada pelo OneDrive.",
      dest_label_html:
        'Pasta de Destino (Google Drive) <span class="required-tag" aria-hidden="true">*</span>',
      dest_placeholder: "Ex: G:\\Meu Drive\\Backup OneDrive",
      dest_help: "Caminho local da pasta onde você está colando os arquivos no Google Drive.",
      browse_btn: "Procurar…",
      browse_opening: "Abrindo janela...",
      pick_source_aria: "Selecionar pasta de origem (OneDrive) em janela do sistema",
      pick_dest_aria: "Selecionar pasta de destino (Google Drive) em janela do sistema",
      ignore_system_html:
        "Ignorar arquivos ocultos e de sistema (<code>desktop.ini</code>, <code>Thumbs.db</code>, temporários)",
      start_scan_btn: "Analisar Diferenças e Gerar Ordem",
      scan_status_title_default: "Analisando pastas sem acionar downloads...",
      scan_status_detail_default: "Iniciando leitura de metadados.",
      scan_files_read: (src, dst) =>
        `Arquivos lidos — Origem (OneDrive): ${src} | Destino (Google Drive): ${dst}`,
      err_fill_paths:
        "Por favor, preencha os caminhos da pasta do OneDrive e da pasta do Google Drive.",
      err_pick_folder: "Não foi possível abrir o seletor de pastas: ",
      err_start_scan: "Erro ao iniciar análise.",
      err_load_report: "Erro ao carregar relatório: ",
      transfer_heading: "Progresso da Transferência por Lote",
      transfer_state_default: "Copiando arquivos com verificação de integridade…",
      cancel_transfer_btn: "Interromper com Segurança",
      transfer_progress_aria: "Progresso geral da transferência do lote",
      meta_current_file: "Arquivo atual",
      meta_speed: "Velocidade média",
      meta_eta: "Tempo restante estimado",
      eta_calculating: "Calculando...",
      eta_completed: "Concluído",
      errors_heading: "Arquivos que falharam neste lote:",
      summary_heading: "2. Diagnóstico da Migração",
      summary_timestamp: (at, src, dst) =>
        `Análise concluída em ${at} • Origem: ${src} → Destino: ${dst}`,
      free_space_btn_available: (bytes, count) =>
        `Liberar ${bytes} no OneDrive (${count} arquivos já copiados)`,
      free_space_btn_none: "Nenhum espaço extra de arquivos já copiados para liberar",
      free_space_btn_working: "Liberando espaço local no OneDrive...",
      free_space_desc:
        'Marca como “Apenas online” no OneDrive apenas os arquivos já confirmados no Google Drive.',
      free_space_confirm:
        "Deseja marcar como 'Apenas online' no OneDrive os arquivos que JÁ foram confirmados com o mesmo tamanho no Google Drive?\n\nIsso libera espaço no seu computador sem apagar nada da nuvem do OneDrive.",
      free_space_success: (count, bytes) =>
        `Espaço liberado com sucesso!\n\nArquivos convertidos para 'Apenas online': ${count}\nEspaço liberado no disco: ${bytes}`,
      overall_pct_title: "Progresso Total da Migração",
      overall_pct_stats: (pctF, syncedC, totalC, pctB, syncedB, totalB) =>
        `${pctF}% dos arquivos (${syncedC} de ${totalC}) • ${pctB}% do volume (${syncedB} de ${totalB})`,
      kpi_region_aria: "Indicadores principais da comparação",
      kpi_title_synced: "Já Transferidos (OK)",
      kpi_sub_synced: (bytes) => `${bytes} confirmados no destino`,
      kpi_title_pending: "Faltam Transferir (Total)",
      kpi_sub_pending: (bytes, miss, mis) =>
        `${bytes} pendentes (${miss} faltando, ${mis} com tamanho diferente)`,
      kpi_title_local: "Pendentes JÁ NO DISCO LOCAL",
      kpi_sub_local: (bytes) => `${bytes} prontos para cópia imediata`,
      kpi_title_cloud: "Pendentes APENAS NA NUVEM",
      kpi_sub_cloud: (bytes) => `${bytes} precisam baixar do OneDrive`,
      dehydrate_label_html:
        "<strong>Liberar espaço automaticamente após cada cópia:</strong> ao transferir um lote por aqui, liberar o espaço local do arquivo no OneDrive assim que a cópia no Google Drive for validada (evita lotar seu HD/SSD).",
      plan_heading: "3. Plano de Transferência e Lista de Arquivos",
      tabs_aria: "Visualizações do relatório",
      tab_batches: "Lotes Recomendados",
      tab_queue: "Fila Ordenada de Arquivos",
      tab_folders: "Progresso por Subpasta",
      tab_synced: "Já Transferidos",
      batches_intro_title: "Em qual ordem transferir? (Divisão Inteligente em Lotes)",
      batches_intro_html:
        "Para evitar que o Windows trave tentando baixar tudo do OneDrive de uma vez, dividimos os arquivos pendentes na ordem ideal: <strong>primeiro tudo o que já está salvo localmente no seu computador</strong> (transferência imediata) e, em seguida, <strong>lotes na nuvem de até ~500 MB</strong> ordenados das subpastas e arquivos mais leves para os mais pesados.",
      multi_batch_aria: "Seleção e execução de múltiplos lotes",
      multi_batch_label: "Seleção rápida:",
      quick_next_n: (n) => `Próximos ${n} lotes`,
      select_all_local_btn: "Todos os Lotes Locais",
      clear_selection_btn: "Limpar seleção",
      multi_batch_none:
        "Nenhum lote selecionado (marque os cards abaixo ou use os botões rápidos)",
      multi_batch_selected: (count, files, bytes) =>
        `${count} lote(s) selecionado(s) • ${files} arquivo(s) • ${bytes}`,
      transfer_selected_zero: "🚀 Transferir Lotes Selecionados (0)",
      transfer_selected_active: (count, bytes) =>
        `🚀 Transferir Lotes Selecionados (${count} lotes • ${bytes})`,
      transfer_selected_label: (count) => `${count} Lote(s) Selecionado(s)`,
      all_batches_done:
        "Parabéns! Todos os arquivos da pasta de origem já estão transferidos e verificados na pasta de destino.",
      step_n: (n) => `${n}º Passo`,
      select_this_batch: (n) => `Selecionar este lote (${n}º Passo)`,
      files_unit: "arquivo(s)",
      subfolders_unit: "subpasta(s)",
      files_short: "arq.",
      root_folder_label: "(Raiz)",
      root_folder_long: "(Raiz da pasta)",
      show_batch_folders: (n) => `📂 Ver pastas deste lote (${n})`,
      hide_batch_folders: (n) => `📂 Ocultar pastas deste lote (${n})`,
      main_folders_heading: (n) => `Pastas Principais (${n}):`,
      exact_subfolders_heading: (n) => `Subpastas Exatas (${n}):`,
      transfer_this_batch_btn: (bytes) => `Transferir Este Lote Agora (${bytes})`,
      queue_intro_title: "Fila Completa de Arquivos Pendentes (Na Ordem Sugerida)",
      queue_intro_desc:
        "Você pode filtrar por fase, disponibilidade no OneDrive ou pesquisar uma pasta/arquivo específico e transferir os itens selecionados.",
      queue_filter_aria: "Filtros da fila de arquivos",
      queue_search_label: "Buscar caminho ou arquivo",
      queue_search_placeholder: "Digite nome da pasta ou arquivo...",
      queue_stage_label: "Filtrar por Fase / Disponibilidade",
      stage_opt_all: "Todas as fases pendentes",
      stage_opt_1: "Fase 1: Já no disco local (Sem download)",
      stage_opt_2: "Fase 2: Nuvem - Pequenos (≤ 10 MB)",
      stage_opt_3: "Fase 3: Nuvem - Médios (10 MB – 100 MB)",
      stage_opt_4: "Fase 4: Nuvem - Grandes (> 100 MB)",
      queue_status_label: "Motivo da Pendência",
      status_opt_all: "Todos (Faltando + Tamanho diferente)",
      status_opt_missing: "Apenas faltando no Google Drive",
      status_opt_mismatch: "Apenas tamanho diferente / incompleto",
      transfer_filtered_btn: "Transferir Arquivos Filtrados",
      queue_filter_summary: (count, bytes) =>
        `Exibindo ${count} arquivo(s) pendente(s) somando ${bytes}.`,
      queue_caption: "Lista de arquivos pendentes ordenada por prioridade de transferência",
      th_order: "Ordem",
      th_onedrive_state: "Estado no OneDrive",
      th_dest_status: "Status no Destino",
      th_subfolder: "Subpasta",
      th_file: "Arquivo",
      th_size: "Tamanho",
      th_action: "Ação",
      queue_empty: "Nenhum arquivo pendente corresponde aos filtros selecionados.",
      badge_local: "✔ Local (No disco)",
      badge_cloud: "☁ Apenas Nuvem",
      badge_missing: "Faltando no destino",
      badge_mismatch: "Tamanho diferente",
      btn_copy_single: "Copiar",
      btn_copy_single_aria: (name) => `Transferir arquivo ${name}`,
      page_prev: "← Página Anterior",
      page_next: "Próxima Página →",
      page_info: (cur, tot) => `Página ${cur} de ${tot}`,
      filtered_selection_label: (n) => `Seleção Filtrada (${n} arquivos)`,
      folders_intro_title: "Status por Subpasta",
      folders_intro_desc:
        "Veja quais subpastas já estão 100% salvas no Google Drive e quais ainda têm arquivos faltando. Você pode transferir uma subpasta inteira com um clique.",
      folder_search_label: "Buscar subpasta",
      folder_search_placeholder: "Filtrar nome da subpasta...",
      folder_status_label: "Exibir",
      folder_opt_all: "Todas as subpastas",
      folder_opt_pending: "Apenas subpastas com pendências",
      folder_opt_complete: "Apenas subpastas 100% concluídas",
      folders_caption: "Progresso de transferência agrupado por subpasta",
      th_progress: "Progresso",
      th_synced_total: "Transferidos / Total",
      th_pending_loc_cloud: "Pendentes (Local / Nuvem)",
      th_pending_size: "Tamanho Pendente",
      folders_empty: "Nenhuma subpasta encontrada para este filtro.",
      badge_100_done: "✔ 100% Concluída",
      badge_pct_done: (pct) => `${pct}% concluída`,
      folder_complete_text: "Completa",
      btn_transfer_folder: (n) => `Transferir Pasta (${n})`,
      loc_cloud_counts: (loc, cld) => `${loc} locais / ${cld} nuvem`,
      synced_intro_title: "Arquivos Confirmados no Google Drive",
      synced_intro_html:
        "Estes arquivos já existem na pasta de destino com o mesmo tamanho exato da origem e <strong>não precisam ser copiados novamente</strong>.",
      synced_search_label: "Buscar nos arquivos já transferidos",
      synced_search_placeholder: "Digite o nome do arquivo ou subpasta...",
      synced_summary_note: (count) =>
        `Total de ${count} arquivo(s) confirmado(s) no destino (exibindo até 200 linhas).`,
      synced_caption: "Arquivos que já foram transferidos com sucesso",
      synced_empty: "Nenhum arquivo transferido encontrado para este filtro.",
      badge_taking_local_space: "Ocupando espaço local no OneDrive",
      badge_online_only_free: "Apenas online no OneDrive (Espaço livre)",
      transferring_batch: (label, count) => `Transferindo ${label} (${count} arquivos)...`,
      transfer_counts_status: (done, total, ver, failed) =>
        `${done} de ${total} concluídos • 🔒 ${ver} verificados com SHA-256 (${failed} falhas)`,
      transfer_completed_msg: (done) =>
        `Lote finalizado! ${done} arquivo(s) transferido(s) e verificado(s) bit a bit com hash SHA-256.`,
      transfer_cancelled_msg: (done) =>
        `Transferência interrompida com segurança após ${done} arquivo(s). Nenhum arquivo parcial ficou corrompido.`,
      footer_html:
        "Local Transfer: OneDrive &rarr; Google Drive &bull; Conformidade de acessibilidade WCAG 2.1 AA &bull; Cópia atômica com verificação SHA-256.",
    },
    en: {
      html_lang: "en",
      locale: "en-US",
      skip_link: "Skip to main content",
      subtitle_html:
        "Compares both folders <strong>without triggering OneDrive downloads</strong>, identifies files already on the local disk, and recommends the optimal batch transfer order.",
      export_audit_btn: "Download Audit Log (SHA-256)",
      export_csv_btn: "Export Plan (CSV)",
      folders_heading: "1. Select Folders to Compare",
      folders_desc:
        "Enter or select the source folder (OneDrive) and destination folder (Google Drive). Scanning reads file system metadata only.",
      source_label_html:
        'Source Folder (OneDrive) <span class="required-tag" aria-hidden="true">*</span>',
      source_placeholder: "e.g., C:\\Users\\YourName\\OneDrive\\Documents",
      source_help: "Local path to the folder synced by OneDrive.",
      dest_label_html:
        'Destination Folder (Google Drive) <span class="required-tag" aria-hidden="true">*</span>',
      dest_placeholder: "e.g., G:\\My Drive\\OneDrive Backup",
      dest_help: "Local path to the destination folder in Google Drive.",
      browse_btn: "Browse…",
      browse_opening: "Opening dialog...",
      pick_source_aria: "Select source folder (OneDrive) in system dialog",
      pick_dest_aria: "Select destination folder (Google Drive) in system dialog",
      ignore_system_html:
        "Ignore hidden and system files (<code>desktop.ini</code>, <code>Thumbs.db</code>, temporary files)",
      start_scan_btn: "Analyze Differences and Generate Order",
      scan_status_title_default: "Scanning folders without triggering downloads...",
      scan_status_detail_default: "Starting metadata scan.",
      scan_files_read: (src, dst) =>
        `Files scanned — Source (OneDrive): ${src} | Destination (Google Drive): ${dst}`,
      err_fill_paths:
        "Please enter both the OneDrive source folder path and the Google Drive destination folder path.",
      err_pick_folder: "Could not open folder picker: ",
      err_start_scan: "Failed to start folder scan.",
      err_load_report: "Error loading report: ",
      transfer_heading: "Batch Transfer Progress",
      transfer_state_default: "Copying files with integrity verification…",
      cancel_transfer_btn: "Stop Safely",
      transfer_progress_aria: "Overall batch transfer progress",
      meta_current_file: "Current file",
      meta_speed: "Average speed",
      meta_eta: "Estimated time remaining",
      eta_calculating: "Calculating...",
      eta_completed: "Completed",
      errors_heading: "Files that failed in this batch:",
      summary_heading: "2. Migration Diagnostics",
      summary_timestamp: (at, src, dst) =>
        `Scan completed at ${at} • Source: ${src} → Destination: ${dst}`,
      free_space_btn_available: (bytes, count) =>
        `Free ${bytes} on OneDrive (${count} already-copied files)`,
      free_space_btn_none: "No extra local space to free from already-copied files",
      free_space_btn_working: "Freeing local space on OneDrive...",
      free_space_desc:
        'Marks as “Online-only” on OneDrive only the files already verified in Google Drive.',
      free_space_confirm:
        "Do you want to mark as 'Online-only' on OneDrive the files that are ALREADY confirmed with the same size in Google Drive?\n\nThis frees up space on your computer without deleting anything from your OneDrive cloud.",
      free_space_success: (count, bytes) =>
        `Space freed successfully!\n\nFiles converted to 'Online-only': ${count}\nDisk space freed: ${bytes}`,
      overall_pct_title: "Overall Migration Progress",
      overall_pct_stats: (pctF, syncedC, totalC, pctB, syncedB, totalB) =>
        `${pctF}% of files (${syncedC} of ${totalC}) • ${pctB}% of volume (${syncedB} of ${totalB})`,
      kpi_region_aria: "Key comparison metrics",
      kpi_title_synced: "Already Transferred (OK)",
      kpi_sub_synced: (bytes) => `${bytes} confirmed at destination`,
      kpi_title_pending: "Remaining to Transfer (Total)",
      kpi_sub_pending: (bytes, miss, mis) =>
        `${bytes} pending (${miss} missing, ${mis} size mismatch)`,
      kpi_title_local: "Pending ALREADY ON LOCAL DISK",
      kpi_sub_local: (bytes) => `${bytes} ready for instant copy`,
      kpi_title_cloud: "Pending CLOUD-ONLY",
      kpi_sub_cloud: (bytes) => `${bytes} require OneDrive download`,
      dehydrate_label_html:
        "<strong>Automatically free space after each copy:</strong> when transferring a batch here, free the local file space on OneDrive as soon as the Google Drive copy is verified (prevents filling up your drive).",
      plan_heading: "3. Transfer Plan and File List",
      tabs_aria: "Report views",
      tab_batches: "Recommended Batches",
      tab_queue: "Ordered File Queue",
      tab_folders: "Progress by Subfolder",
      tab_synced: "Already Transferred",
      batches_intro_title: "In what order to transfer? (Smart Batch Splitting)",
      batches_intro_html:
        "To prevent Windows from freezing while trying to download everything from OneDrive at once, pending files are split in the optimal order: <strong>first everything already stored locally on your computer</strong> (instant transfer), followed by <strong>cloud batches of up to ~500 MB</strong> ordered from the lightest subfolders and files to the heaviest.",
      multi_batch_aria: "Multiple batch selection and execution",
      multi_batch_label: "Quick select:",
      quick_next_n: (n) => `Next ${n} batches`,
      select_all_local_btn: "All Local Batches",
      clear_selection_btn: "Clear selection",
      multi_batch_none:
        "No batch selected (check the cards below or use the quick select buttons)",
      multi_batch_selected: (count, files, bytes) =>
        `${count} batch(es) selected • ${files} file(s) • ${bytes}`,
      transfer_selected_zero: "🚀 Transfer Selected Batches (0)",
      transfer_selected_active: (count, bytes) =>
        `🚀 Transfer Selected Batches (${count} batches • ${bytes})`,
      transfer_selected_label: (count) => `${count} Selected Batch(es)`,
      all_batches_done:
        "Congratulations! All files from the source folder have been transferred and verified in the destination folder.",
      step_n: (n) => `Step ${n}`,
      select_this_batch: (n) => `Select this batch (Step ${n})`,
      files_unit: "file(s)",
      subfolders_unit: "subfolder(s)",
      files_short: "files",
      root_folder_label: "(Root)",
      root_folder_long: "(Root folder)",
      show_batch_folders: (n) => `📂 View folders in this batch (${n})`,
      hide_batch_folders: (n) => `📂 Hide folders in this batch (${n})`,
      main_folders_heading: (n) => `Top-Level Folders (${n}):`,
      exact_subfolders_heading: (n) => `Exact Subfolders (${n}):`,
      transfer_this_batch_btn: (bytes) => `Transfer This Batch Now (${bytes})`,
      queue_intro_title: "Full Pending File Queue (In Recommended Order)",
      queue_intro_desc:
        "Filter by phase, OneDrive availability, or search for a specific folder/file and transfer the filtered items.",
      queue_filter_aria: "File queue filters",
      queue_search_label: "Search path or file",
      queue_search_placeholder: "Type folder or file name...",
      queue_stage_label: "Filter by Phase / Availability",
      stage_opt_all: "All pending phases",
      stage_opt_1: "Phase 1: Already on local disk (No download)",
      stage_opt_2: "Phase 2: Cloud - Small (≤ 10 MB)",
      stage_opt_3: "Phase 3: Cloud - Medium (10 MB – 100 MB)",
      stage_opt_4: "Phase 4: Cloud - Large (> 100 MB)",
      queue_status_label: "Pending Reason",
      status_opt_all: "All (Missing + Size mismatch)",
      status_opt_missing: "Missing in Google Drive only",
      status_opt_mismatch: "Size mismatch / incomplete only",
      transfer_filtered_btn: "Transfer Filtered Files",
      queue_filter_summary: (count, bytes) =>
        `Showing ${count} pending file(s) totaling ${bytes}.`,
      queue_caption: "Pending files list ordered by transfer priority",
      th_order: "Order",
      th_onedrive_state: "OneDrive State",
      th_dest_status: "Destination Status",
      th_subfolder: "Subfolder",
      th_file: "File",
      th_size: "Size",
      th_action: "Action",
      queue_empty: "No pending files match the selected filters.",
      badge_local: "✔ Local (On disk)",
      badge_cloud: "☁ Cloud-Only",
      badge_missing: "Missing at destination",
      badge_mismatch: "Size mismatch",
      btn_copy_single: "Copy",
      btn_copy_single_aria: (name) => `Transfer file ${name}`,
      page_prev: "← Previous Page",
      page_next: "Next Page →",
      page_info: (cur, tot) => `Page ${cur} of ${tot}`,
      filtered_selection_label: (n) => `Filtered Selection (${n} files)`,
      folders_intro_title: "Status by Subfolder",
      folders_intro_desc:
        "See which subfolders are already 100% saved in Google Drive and which still have missing files. You can transfer an entire subfolder with one click.",
      folder_search_label: "Search subfolder",
      folder_search_placeholder: "Filter subfolder name...",
      folder_status_label: "Show",
      folder_opt_all: "All subfolders",
      folder_opt_pending: "Subfolders with pending files only",
      folder_opt_complete: "100% completed subfolders only",
      folders_caption: "Transfer progress grouped by subfolder",
      th_progress: "Progress",
      th_synced_total: "Transferred / Total",
      th_pending_loc_cloud: "Pending (Local / Cloud)",
      th_pending_size: "Pending Size",
      folders_empty: "No subfolders found for this filter.",
      badge_100_done: "✔ 100% Completed",
      badge_pct_done: (pct) => `${pct}% completed`,
      folder_complete_text: "Complete",
      btn_transfer_folder: (n) => `Transfer Folder (${n})`,
      loc_cloud_counts: (loc, cld) => `${loc} local / ${cld} cloud`,
      synced_intro_title: "Confirmed Files in Google Drive",
      synced_intro_html:
        "These files already exist in the destination folder with the exact same byte size as the source and <strong>do not need to be copied again</strong>.",
      synced_search_label: "Search already-transferred files",
      synced_search_placeholder: "Type file or subfolder name...",
      synced_summary_note: (count) =>
        `Total of ${count} confirmed file(s) at destination (showing up to 200 rows).`,
      synced_caption: "Files that have already been transferred successfully",
      synced_empty: "No transferred files found for this filter.",
      badge_taking_local_space: "Taking local space on OneDrive",
      badge_online_only_free: "Online-only on OneDrive (Free space)",
      transferring_batch: (label, count) => `Transferring ${label} (${count} files)...`,
      transfer_counts_status: (done, total, ver, failed) =>
        `${done} of ${total} completed • 🔒 ${ver} verified with SHA-256 (${failed} failed)`,
      transfer_completed_msg: (done) =>
        `Batch finished! ${done} file(s) transferred and verified bit-by-bit with SHA-256 hash.`,
      transfer_cancelled_msg: (done) =>
        `Transfer safely stopped after ${done} file(s). No partial or corrupted files were left behind.`,
      footer_html:
        "Local Transfer: OneDrive &rarr; Google Drive &bull; WCAG 2.1 AA Accessibility Compliant &bull; Atomic copy with SHA-256 verification.",
    },
  };

  function dict() {
    return I18N[currentLang] || I18N.pt;
  }

  function translateServerBatchText(str) {
    if (!str || currentLang === "pt") return str;
    return String(str)
      .replace("PRONTO NO DISCO LOCAL (Sem download)", "READY ON LOCAL DISK (No download)")
      .replace("REQUER DOWNLOAD DO ONEDRIVE (Nuvem)", "REQUIRES ONEDRIVE DOWNLOAD (Cloud)")
      .replace(/Lote Local #(\d+) — Transferência Imediata/g, "Local Batch #$1 — Instant Transfer")
      .replace(/Lote na Nuvem #(\d+) — Download Controlado/g, "Cloud Batch #$1 — Controlled Download")
      .replace(
        "Arquivos que já estão fisicamente no seu HD/SSD. Não consomem internet para ler do OneDrive. Pastas principais: ",
        "Files already stored physically on your drive. No internet required to read from OneDrive. Top folders: "
      )
      .replace(
        "Arquivos que estão apenas na nuvem do OneDrive. Lote dimensionado para baixar e copiar sem travar o disco. Pastas principais: ",
        "Cloud-only files on OneDrive. Batch sized to download and copy without stalling your disk. Top folders: "
      );
  }

  function translateServerPhaseText(str) {
    if (!str || currentLang === "pt") return str;
    return String(str)
      .replace("Copiando e calculando SHA-256 da origem...", "Copying and computing source SHA-256...")
      .replace("Verificando integridade SHA-256 no destino...", "Verifying destination SHA-256 integrity...")
      .replace("Concluído", "Completed")
      .replace("Cancelado pelo usuário.", "Cancelled by user.");
  }

  // Elementos do DOM
  const langPtBtn = document.getElementById("lang-pt-btn");
  const langEnBtn = document.getElementById("lang-en-btn");
  const sourceInput = document.getElementById("source-input");
  const destInput = document.getElementById("dest-input");
  const pickSourceBtn = document.getElementById("pick-source-btn");
  const pickDestBtn = document.getElementById("pick-dest-btn");
  const ignoreSystemChk = document.getElementById("ignore-system-chk");
  const scanForm = document.getElementById("scan-form");
  const startScanBtn = document.getElementById("start-scan-btn");
  const scanAlert = document.getElementById("scan-alert");
  const scanStatusBox = document.getElementById("scan-status-box");
  const scanStatusTitle = document.getElementById("scan-status-title");
  const scanStatusDetail = document.getElementById("scan-status-detail");
  const exportCsvBtn = document.getElementById("export-csv-btn");
  const exportAuditBtn = document.getElementById("export-audit-btn");

  const reportContainer = document.getElementById("report-container");
  const summaryTimestamp = document.getElementById("summary-timestamp");
  const freeSpaceBtn = document.getElementById("free-space-btn");
  const dehydrateAfterCopyChk = document.getElementById("dehydrate-after-copy-chk");

  const overallPctStats = document.getElementById("overall-pct-stats");
  const overallProgressbar = document.getElementById("overall-progressbar");
  const overallProgressFill = document.getElementById("overall-progress-fill");

  const kpiSyncedCount = document.getElementById("kpi-synced-count");
  const kpiSyncedBytes = document.getElementById("kpi-synced-bytes");
  const kpiPendingCount = document.getElementById("kpi-pending-count");
  const kpiPendingBytes = document.getElementById("kpi-pending-bytes");
  const kpiLocalPendingCount = document.getElementById("kpi-local-pending-count");
  const kpiLocalPendingBytes = document.getElementById("kpi-local-pending-bytes");
  const kpiCloudPendingCount = document.getElementById("kpi-cloud-pending-count");
  const kpiCloudPendingBytes = document.getElementById("kpi-cloud-pending-bytes");

  const tabCountBatches = document.getElementById("tab-count-batches");
  const tabCountQueue = document.getElementById("tab-count-queue");
  const tabCountFolders = document.getElementById("tab-count-folders");
  const tabCountSynced = document.getElementById("tab-count-synced");

  const batchesList = document.getElementById("batches-list");
  const multiBatchSummary = document.getElementById("multi-batch-summary");
  const transferSelectedBatchesBtn = document.getElementById("transfer-selected-batches-btn");
  const selectAllLocalBatchesBtn = document.getElementById("select-all-local-batches-btn");
  const clearBatchSelectionBtn = document.getElementById("clear-batch-selection-btn");

  const queueSearch = document.getElementById("queue-search");
  const queueStageFilter = document.getElementById("queue-stage-filter");
  const queueStatusFilter = document.getElementById("queue-status-filter");
  const transferFilteredBtn = document.getElementById("transfer-filtered-btn");
  const filteredCountBadge = document.getElementById("filtered-count-badge");
  const queueFilterSummary = document.getElementById("queue-filter-summary");
  const queueTbody = document.getElementById("queue-tbody");
  const queuePrevBtn = document.getElementById("queue-prev-btn");
  const queueNextBtn = document.getElementById("queue-next-btn");
  const queuePageInfo = document.getElementById("queue-page-info");

  const folderSearch = document.getElementById("folder-search");
  const folderStatusFilter = document.getElementById("folder-status-filter");
  const foldersTbody = document.getElementById("folders-tbody");

  const syncedSearch = document.getElementById("synced-search");
  const syncedSummaryNote = document.getElementById("synced-summary-note");
  const syncedTbody = document.getElementById("synced-tbody");

  // Painel de Transferência
  const transferPanel = document.getElementById("transfer-panel");
  const transferStateText = document.getElementById("transfer-state-text");
  const cancelTransferBtn = document.getElementById("cancel-transfer-btn");
  const transferCountsLabel = document.getElementById("transfer-counts-label");
  const transferBytesLabel = document.getElementById("transfer-bytes-label");
  const transferProgressbar = document.getElementById("transfer-progressbar");
  const transferProgressFill = document.getElementById("transfer-progress-fill");
  const transferCurrentFile = document.getElementById("transfer-current-file");
  const transferSpeed = document.getElementById("transfer-speed");
  const transferEta = document.getElementById("transfer-eta");
  const transferErrorsContainer = document.getElementById("transfer-errors-container");
  const transferErrorsList = document.getElementById("transfer-errors-list");

  // Utilitários de Formatação
  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return "0 B";
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const k = 1024;
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    const val = bytes / Math.pow(k, i);
    return `${val.toLocaleString(dict().locale, {
      minimumFractionDigits: i === 0 ? 0 : 1,
      maximumFractionDigits: i === 0 ? 0 : 2,
    })} ${units[i]}`;
  }

  function formatNumber(n) {
    return (n || 0).toLocaleString(dict().locale);
  }

  function formatDuration(sec) {
    if (sec === null || sec === undefined || !isFinite(sec) || sec < 0)
      return dict().eta_calculating;
    if (sec < 60) return `${sec} s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return `${m} min ${s} s`;
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h} h ${remM} min`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setTextWithBadge(btnEl, labelText, badgeEl) {
    if (!btnEl || !badgeEl) return;
    const countText = badgeEl.textContent;
    btnEl.textContent = "";
    btnEl.appendChild(document.createTextNode(`${labelText} (`));
    badgeEl.textContent = countText;
    btnEl.appendChild(badgeEl);
    btnEl.appendChild(document.createTextNode(")"));
  }

  function applyLanguage(lang) {
    currentLang = lang === "en" ? "en" : "pt";
    localStorage.setItem("lt_ui_lang", currentLang);
    const d = dict();

    document.documentElement.lang = d.html_lang;

    if (langPtBtn && langEnBtn) {
      const isPt = currentLang === "pt";
      langPtBtn.classList.toggle("active", isPt);
      langPtBtn.setAttribute("aria-pressed", isPt ? "true" : "false");
      langEnBtn.classList.toggle("active", !isPt);
      langEnBtn.setAttribute("aria-pressed", !isPt ? "true" : "false");
    }

    const skipLink = document.querySelector(".skip-link");
    if (skipLink) skipLink.textContent = d.skip_link;

    const subtitleEl = document.querySelector(".subtitle");
    if (subtitleEl) subtitleEl.innerHTML = d.subtitle_html;

    if (exportAuditBtn) exportAuditBtn.textContent = d.export_audit_btn;
    if (exportCsvBtn) exportCsvBtn.textContent = d.export_csv_btn;

    const foldersHeading = document.getElementById("folders-heading");
    if (foldersHeading) {
      foldersHeading.textContent = d.folders_heading;
      const desc = foldersHeading.parentElement.querySelector(".section-desc");
      if (desc) desc.textContent = d.folders_desc;
    }

    const srcLabel = document.querySelector('label[for="source-input"]');
    if (srcLabel) srcLabel.innerHTML = d.source_label_html;
    if (sourceInput) sourceInput.placeholder = d.source_placeholder;
    if (pickSourceBtn) {
      pickSourceBtn.textContent = d.browse_btn;
      pickSourceBtn.setAttribute("aria-label", d.pick_source_aria);
    }
    const srcHelp = document.getElementById("source-help");
    if (srcHelp) srcHelp.textContent = d.source_help;

    const dstLabel = document.querySelector('label[for="dest-input"]');
    if (dstLabel) dstLabel.innerHTML = d.dest_label_html;
    if (destInput) destInput.placeholder = d.dest_placeholder;
    if (pickDestBtn) {
      pickDestBtn.textContent = d.browse_btn;
      pickDestBtn.setAttribute("aria-label", d.pick_dest_aria);
    }
    const dstHelp = document.getElementById("dest-help");
    if (dstHelp) dstHelp.textContent = d.dest_help;

    const ignoreLabel = document.querySelector('label[for="ignore-system-chk"]');
    if (ignoreLabel) ignoreLabel.innerHTML = d.ignore_system_html;
    if (startScanBtn) startScanBtn.textContent = d.start_scan_btn;

    const transferHeading = document.getElementById("transfer-heading");
    if (transferHeading) transferHeading.textContent = d.transfer_heading;
    if (cancelTransferBtn) cancelTransferBtn.textContent = d.cancel_transfer_btn;
    if (transferProgressbar)
      transferProgressbar.setAttribute("aria-label", d.transfer_progress_aria);

    const metaLabels = document.querySelectorAll(".transfer-meta-grid .meta-label");
    if (metaLabels.length >= 3) {
      metaLabels[0].textContent = d.meta_current_file;
      metaLabels[1].textContent = d.meta_speed;
      metaLabels[2].textContent = d.meta_eta;
    }

    const errHeading = document.querySelector(".error-list-heading");
    if (errHeading) errHeading.textContent = d.errors_heading;

    const summaryHeading = document.getElementById("summary-heading");
    if (summaryHeading) summaryHeading.textContent = d.summary_heading;

    const freeSpaceDesc = document.getElementById("free-space-desc");
    if (freeSpaceDesc) freeSpaceDesc.textContent = d.free_space_desc;

    const overallTitle = document.getElementById("overall-pct-title");
    if (overallTitle) overallTitle.textContent = d.overall_pct_title;

    const kpiGrid = document.querySelector(".kpi-grid");
    if (kpiGrid) kpiGrid.setAttribute("aria-label", d.kpi_region_aria);
    const kpiTitles = document.querySelectorAll(".kpi-grid .kpi-title");
    if (kpiTitles.length >= 4) {
      kpiTitles[0].textContent = d.kpi_title_synced;
      kpiTitles[1].textContent = d.kpi_title_pending;
      kpiTitles[2].textContent = d.kpi_title_local;
      kpiTitles[3].textContent = d.kpi_title_cloud;
    }

    const dehydrateLabel = document.querySelector('label[for="dehydrate-after-copy-chk"]');
    if (dehydrateLabel) dehydrateLabel.innerHTML = d.dehydrate_label_html;

    const planHeading = document.getElementById("plan-heading");
    if (planHeading) planHeading.textContent = d.plan_heading;

    const tabsBar = document.querySelector(".tabs-bar");
    if (tabsBar) tabsBar.setAttribute("aria-label", d.tabs_aria);

    setTextWithBadge(document.getElementById("tab-batches"), d.tab_batches, tabCountBatches);
    setTextWithBadge(document.getElementById("tab-queue"), d.tab_queue, tabCountQueue);
    setTextWithBadge(document.getElementById("tab-folders"), d.tab_folders, tabCountFolders);
    setTextWithBadge(document.getElementById("tab-synced"), d.tab_synced, tabCountSynced);

    // Painel 1: Lotes
    const batchesIntro = document.querySelector("#panel-batches .panel-intro");
    if (batchesIntro) {
      const h3 = batchesIntro.querySelector("h3");
      const p = batchesIntro.querySelector("p");
      if (h3) h3.textContent = d.batches_intro_title;
      if (p) p.innerHTML = d.batches_intro_html;
    }

    const multiToolbar = document.getElementById("multi-batch-toolbar");
    if (multiToolbar) multiToolbar.setAttribute("aria-label", d.multi_batch_aria);
    const multiLabel = document.querySelector(".multi-batch-label");
    if (multiLabel) multiLabel.textContent = d.multi_batch_label;

    document.querySelectorAll(".quick-select-btn").forEach((btn) => {
      const cnt = btn.getAttribute("data-select-count");
      btn.textContent = d.quick_next_n(cnt);
    });
    if (selectAllLocalBatchesBtn) selectAllLocalBatchesBtn.textContent = d.select_all_local_btn;
    if (clearBatchSelectionBtn) clearBatchSelectionBtn.textContent = d.clear_selection_btn;

    // Painel 2: Fila
    const queueIntro = document.querySelector("#panel-queue .panel-intro");
    if (queueIntro) {
      const h3 = queueIntro.querySelector("h3");
      const p = queueIntro.querySelector("p");
      if (h3) h3.textContent = d.queue_intro_title;
      if (p) p.textContent = d.queue_intro_desc;
    }

    const qSearchLabel = document.querySelector('label[for="queue-search"]');
    if (qSearchLabel) qSearchLabel.textContent = d.queue_search_label;
    if (queueSearch) queueSearch.placeholder = d.queue_search_placeholder;

    const qStageLabel = document.querySelector('label[for="queue-stage-filter"]');
    if (qStageLabel) qStageLabel.textContent = d.queue_stage_label;
    if (queueStageFilter && queueStageFilter.options.length >= 5) {
      queueStageFilter.options[0].textContent = d.stage_opt_all;
      queueStageFilter.options[1].textContent = d.stage_opt_1;
      queueStageFilter.options[2].textContent = d.stage_opt_2;
      queueStageFilter.options[3].textContent = d.stage_opt_3;
      queueStageFilter.options[4].textContent = d.stage_opt_4;
    }

    const qStatusLabel = document.querySelector('label[for="queue-status-filter"]');
    if (qStatusLabel) qStatusLabel.textContent = d.queue_status_label;
    if (queueStatusFilter && queueStatusFilter.options.length >= 3) {
      queueStatusFilter.options[0].textContent = d.status_opt_all;
      queueStatusFilter.options[1].textContent = d.status_opt_missing;
      queueStatusFilter.options[2].textContent = d.status_opt_mismatch;
    }

    setTextWithBadge(transferFilteredBtn, d.transfer_filtered_btn, filteredCountBadge);

    const queueCaption = document.querySelector("#panel-queue table caption");
    if (queueCaption) queueCaption.textContent = d.queue_caption;
    const queueThs = document.querySelectorAll("#panel-queue thead th");
    if (queueThs.length >= 7) {
      queueThs[0].textContent = d.th_order;
      queueThs[1].textContent = d.th_onedrive_state;
      queueThs[2].textContent = d.th_dest_status;
      queueThs[3].textContent = d.th_subfolder;
      queueThs[4].textContent = d.th_file;
      queueThs[5].textContent = d.th_size;
      queueThs[6].textContent = d.th_action;
    }
    if (queuePrevBtn) queuePrevBtn.textContent = d.page_prev;
    if (queueNextBtn) queueNextBtn.textContent = d.page_next;

    // Painel 3: Subpastas
    const foldersIntro = document.querySelector("#panel-folders .panel-intro");
    if (foldersIntro) {
      const h3 = foldersIntro.querySelector("h3");
      const p = foldersIntro.querySelector("p");
      if (h3) h3.textContent = d.folders_intro_title;
      if (p) p.textContent = d.folders_intro_desc;
    }
    const fSearchLabel = document.querySelector('label[for="folder-search"]');
    if (fSearchLabel) fSearchLabel.textContent = d.folder_search_label;
    if (folderSearch) folderSearch.placeholder = d.folder_search_placeholder;
    const fStatusLabel = document.querySelector('label[for="folder-status-filter"]');
    if (fStatusLabel) fStatusLabel.textContent = d.folder_status_label;
    if (folderStatusFilter && folderStatusFilter.options.length >= 3) {
      folderStatusFilter.options[0].textContent = d.folder_opt_all;
      folderStatusFilter.options[1].textContent = d.folder_opt_pending;
      folderStatusFilter.options[2].textContent = d.folder_opt_complete;
    }
    const foldersCaption = document.querySelector("#panel-folders table caption");
    if (foldersCaption) foldersCaption.textContent = d.folders_caption;
    const folderThs = document.querySelectorAll("#panel-folders thead th");
    if (folderThs.length >= 6) {
      folderThs[0].textContent = d.th_subfolder;
      folderThs[1].textContent = d.th_progress;
      folderThs[2].textContent = d.th_synced_total;
      folderThs[3].textContent = d.th_pending_loc_cloud;
      folderThs[4].textContent = d.th_pending_size;
      folderThs[5].textContent = d.th_action;
    }

    // Painel 4: Já Transferidos
    const syncedIntro = document.querySelector("#panel-synced .panel-intro");
    if (syncedIntro) {
      const h3 = syncedIntro.querySelector("h3");
      const p = syncedIntro.querySelector("p");
      if (h3) h3.textContent = d.synced_intro_title;
      if (p) p.innerHTML = d.synced_intro_html;
    }
    const sSearchLabel = document.querySelector('label[for="synced-search"]');
    if (sSearchLabel) sSearchLabel.textContent = d.synced_search_label;
    if (syncedSearch) syncedSearch.placeholder = d.synced_search_placeholder;
    const syncedCaption = document.querySelector("#panel-synced table caption");
    if (syncedCaption) syncedCaption.textContent = d.synced_caption;
    const syncedThs = document.querySelectorAll("#panel-synced thead th");
    if (syncedThs.length >= 4) {
      syncedThs[0].textContent = d.th_subfolder;
      syncedThs[1].textContent = d.th_file;
      syncedThs[2].textContent = d.th_size;
      syncedThs[3].textContent = d.th_onedrive_state;
    }

    const footerP = document.querySelector("footer.site-footer p");
    if (footerP) footerP.innerHTML = d.footer_html;

    if (currentReport) {
      const savedSelected = new Set(selectedBatchIndices);
      renderReport(currentReport);
      savedSelected.forEach((idx) => selectedBatchIndices.add(idx));
      updateMultiBatchSummary();
    } else {
      updateMultiBatchSummary();
    }
  }

  if (langPtBtn) {
    langPtBtn.addEventListener("click", () => applyLanguage("pt"));
  }
  if (langEnBtn) {
    langEnBtn.addEventListener("click", () => applyLanguage("en"));
  }

  function showError(msg) {
    if (!msg) {
      scanAlert.classList.add("hidden");
      scanAlert.textContent = "";
      return;
    }
    scanAlert.textContent = msg;
    scanAlert.classList.remove("hidden");
  }

  // Navegação acessível por Abas (WAI-ARIA Tabs Pattern)
  function initAccessibleTabs() {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

    function activateTab(tab, focusTab = false) {
      tabs.forEach((t) => {
        const isSelected = t === tab;
        t.setAttribute("aria-selected", isSelected ? "true" : "false");
        t.setAttribute("tabindex", isSelected ? "0" : "-1");
        t.classList.toggle("active", isSelected);
      });

      panels.forEach((p) => {
        const isTarget = p.id === tab.getAttribute("aria-controls");
        p.classList.toggle("hidden", !isTarget);
      });

      if (focusTab) {
        tab.focus();
      }
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activateTab(tab, false));
      tab.addEventListener("keydown", (e) => {
        let nextIndex = null;
        if (e.key === "ArrowRight") {
          nextIndex = (index + 1) % tabs.length;
        } else if (e.key === "ArrowLeft") {
          nextIndex = (index - 1 + tabs.length) % tabs.length;
        } else if (e.key === "Home") {
          nextIndex = 0;
        } else if (e.key === "End") {
          nextIndex = tabs.length - 1;
        }
        if (nextIndex !== null) {
          e.preventDefault();
          activateTab(tabs[nextIndex], true);
        }
      });
    });
  }

  // Seleção de pasta nativa
  async function pickFolder(role, inputEl, btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = dict().browse_opening;
    try {
      const res = await fetch("/api/pick-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, current: inputEl.value }),
      });
      const data = await res.json();
      if (data.selected) {
        inputEl.value = data.selected;
      }
    } catch (err) {
      showError(dict().err_pick_folder + err.message);
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = dict().browse_btn;
      inputEl.focus();
    }
  }

  pickSourceBtn.addEventListener("click", () => pickFolder("source", sourceInput, pickSourceBtn));
  pickDestBtn.addEventListener("click", () => pickFolder("destination", destInput, pickDestBtn));

  // Início da Análise
  scanForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");

    const source = sourceInput.value.trim();
    const destination = destInput.value.trim();

    if (!source || !destination) {
      showError(dict().err_fill_paths);
      return;
    }

    startScanBtn.disabled = true;
    scanStatusBox.classList.remove("hidden");
    scanStatusTitle.textContent = dict().scan_status_title_default;
    scanStatusDetail.textContent = dict().scan_status_detail_default;

    try {
      const res = await fetch("/api/scan/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          destination,
          ignore_system: ignoreSystemChk.checked,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || dict().err_start_scan);
      }
      startScanPolling();
    } catch (err) {
      startScanBtn.disabled = false;
      scanStatusBox.classList.add("hidden");
      showError(err.message);
    }
  });

  function startScanPolling() {
    if (scanPollTimer) clearInterval(scanPollTimer);
    scanPollTimer = setInterval(async () => {
      try {
        const res = await fetch("/api/scan/status");
        const data = await res.json();
        const prog = data.progress || {};

        scanStatusTitle.textContent = prog.message || dict().scan_status_title_default;
        scanStatusDetail.textContent = dict().scan_files_read(
          formatNumber(prog.source_scanned),
          formatNumber(prog.dest_scanned)
        );

        if (!data.running) {
          clearInterval(scanPollTimer);
          scanPollTimer = null;
          startScanBtn.disabled = false;
          scanStatusBox.classList.add("hidden");

          if (prog.phase === "error" || prog.error) {
            showError(prog.error || prog.message);
          } else if (data.has_report) {
            await loadReport();
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 500);
  }

  async function loadReport() {
    try {
      const res = await fetch("/api/report");
      if (!res.ok) return;
      currentReport = await res.json();
      renderReport(currentReport);
    } catch (err) {
      showError(dict().err_load_report + err.message);
    }
  }

  function renderReport(report) {
    const s = report.summary;
    const d = dict();
    reportContainer.classList.remove("hidden");
    exportCsvBtn.classList.remove("hidden");

    summaryTimestamp.textContent = d.summary_timestamp(s.scanned_at, s.source_dir, s.dest_dir);

    const pctFiles = s.completion_files_pct || 0;
    const pctBytes = s.completion_bytes_pct || 0;
    overallPctStats.textContent = d.overall_pct_stats(
      pctFiles,
      formatNumber(s.synced_count),
      formatNumber(s.total_source_files),
      pctBytes,
      formatBytes(s.synced_bytes),
      formatBytes(s.total_source_bytes)
    );
    overallProgressbar.setAttribute("aria-valuenow", String(Math.round(pctFiles)));
    overallProgressFill.style.width = `${Math.min(100, Math.max(0, pctFiles))}%`;

    kpiSyncedCount.textContent = formatNumber(s.synced_count);
    kpiSyncedBytes.textContent = d.kpi_sub_synced(formatBytes(s.synced_bytes));

    kpiPendingCount.textContent = formatNumber(s.pending_count);
    kpiPendingBytes.textContent = d.kpi_sub_pending(
      formatBytes(s.pending_bytes),
      formatNumber(s.missing_count),
      formatNumber(s.mismatch_count)
    );

    kpiLocalPendingCount.textContent = formatNumber(s.local_pending_count);
    kpiLocalPendingBytes.textContent = d.kpi_sub_local(formatBytes(s.local_pending_bytes));

    kpiCloudPendingCount.textContent = formatNumber(s.cloud_pending_count);
    kpiCloudPendingBytes.textContent = d.kpi_sub_cloud(formatBytes(s.cloud_pending_bytes));

    if (s.synced_local_still_taking_space_count > 0) {
      freeSpaceBtn.disabled = false;
      freeSpaceBtn.textContent = d.free_space_btn_available(
        formatBytes(s.synced_local_still_taking_space_bytes),
        formatNumber(s.synced_local_still_taking_space_count)
      );
    } else {
      freeSpaceBtn.disabled = true;
      freeSpaceBtn.textContent = d.free_space_btn_none;
    }

    tabCountBatches.textContent = formatNumber((report.batches || []).length);
    tabCountQueue.textContent = formatNumber((report.pending_files || []).length);
    tabCountFolders.textContent = formatNumber((report.folders || []).length);
    tabCountSynced.textContent = formatNumber((report.synced_files || []).length);

    renderBatches(report.batches || []);
    applyQueueFilters();
    renderFolders();
    renderSynced();
  }

  function updateMultiBatchSummary() {
    const d = dict();
    const batches = (currentReport && currentReport.batches) || [];
    const sortedIndices = Array.from(selectedBatchIndices)
      .filter((i) => i >= 0 && i < batches.length)
      .sort((a, b) => a - b);

    const count = sortedIndices.length;
    let totalFiles = 0;
    let totalBytes = 0;

    sortedIndices.forEach((idx) => {
      totalFiles += batches[idx].file_count || 0;
      totalBytes += batches[idx].total_bytes || 0;
    });

    if (count === 0) {
      multiBatchSummary.textContent = d.multi_batch_none;
      transferSelectedBatchesBtn.disabled = true;
      transferSelectedBatchesBtn.textContent = d.transfer_selected_zero;
    } else {
      multiBatchSummary.textContent = d.multi_batch_selected(
        formatNumber(count),
        formatNumber(totalFiles),
        formatBytes(totalBytes)
      );
      transferSelectedBatchesBtn.disabled = false;
      transferSelectedBatchesBtn.textContent = d.transfer_selected_active(
        formatNumber(count),
        formatBytes(totalBytes)
      );
    }

    batchesList.querySelectorAll(".batch-card").forEach((card, idx) => {
      const isSel = selectedBatchIndices.has(idx);
      card.classList.toggle("batch-card-selected", isSel);
      const chk = card.querySelector(".batch-select-chk");
      if (chk && chk.checked !== isSel) {
        chk.checked = isSel;
      }
    });
  }

  function renderBatches(batches) {
    const d = dict();
    selectedBatchIndices.clear();
    if (!batches.length) {
      batchesList.innerHTML = `
        <div class="kpi-card kpi-success" style="grid-column: 1 / -1;">
          <strong>${escapeHtml(d.all_batches_done)}</strong>
        </div>
      `;
      updateMultiBatchSummary();
      return;
    }

    batchesList.innerHTML = batches
      .map((b, idx) => {
        const isPriority = b.badge_type === "success";
        const badgeClass = isPriority ? "badge-success" : "badge-info";
        const cardClass = isPriority ? "batch-card batch-card-priority" : "batch-card";
        const iconText = isPriority ? "⚡" : "☁️";

        const roots = b.root_folders || [];
        const subs = b.subfolders || [];
        const subCount = b.subfolder_count || subs.length || 0;
        const panelId = `batch-folders-panel-${idx}`;
        const chkId = `chk-batch-${idx}`;

        const badgeText = translateServerBatchText(b.badge);
        const titleText = translateServerBatchText(b.title);
        const descText = translateServerBatchText(b.description);

        const rootsHtml = roots
          .map(
            (r) =>
              `<li class="batch-folder-item">
                 <span class="mono"><strong>${escapeHtml(r.folder)}</strong></span>
                 <span class="batch-folder-meta">${formatNumber(r.count)} ${escapeHtml(
                d.files_short
              )} &bull; ${formatBytes(r.bytes)}</span>
               </li>`
          )
          .join("");

        const subsHtml = subs
          .map(
            (sf) =>
              `<li class="batch-folder-item">
                 <span class="mono">${escapeHtml(
                   sf.folder === "." ? d.root_folder_label : sf.folder
                 )}</span>
                 <span class="batch-folder-meta">${formatNumber(sf.count)} ${escapeHtml(
                d.files_short
              )} &bull; ${formatBytes(sf.bytes)}</span>
               </li>`
          )
          .join("");

        return `
          <article class="${cardClass}" data-card-index="${idx}">
            <div>
              <label class="batch-select-row" for="${chkId}">
                <input
                  type="checkbox"
                  id="${chkId}"
                  class="batch-select-chk"
                  data-batch-index="${idx}"
                />
                <span>${escapeHtml(d.select_this_batch(idx + 1))}</span>
              </label>

              <div class="batch-top">
                <span class="badge ${badgeClass}">${escapeHtml(iconText)} ${escapeHtml(
          badgeText
        )}</span>
                <span class="order-pill">${escapeHtml(d.step_n(idx + 1))}</span>
              </div>
              <h4 class="batch-title">${escapeHtml(titleText)}</h4>
              <p class="batch-desc">${escapeHtml(descText)}</p>
            </div>

            <div>
              <div class="batch-stats" style="margin-bottom: 10px;">
                <span>📁 ${formatNumber(b.file_count)} ${escapeHtml(d.files_unit)}</span>
                <span>📂 ${formatNumber(subCount)} ${escapeHtml(d.subfolders_unit)}</span>
                <span>💾 ${formatBytes(b.total_bytes)}</span>
              </div>

              <button
                type="button"
                class="btn btn-secondary btn-sm toggle-batch-folders-btn"
                style="width: 100%; margin-bottom: 8px;"
                aria-expanded="false"
                aria-controls="${panelId}"
                data-panel-id="${panelId}"
                data-sub-count="${subCount}"
              >
                ${escapeHtml(d.show_batch_folders(formatNumber(subCount)))}
              </button>

              <div
                id="${panelId}"
                class="batch-folders-drawer hidden"
                role="region"
                aria-label="${escapeHtml(titleText)}"
              >
                <div class="drawer-section">
                  <strong class="drawer-heading">${escapeHtml(
                    d.main_folders_heading(roots.length)
                  )}</strong>
                  <ul class="batch-folder-list">${rootsHtml}</ul>
                </div>
                <div class="drawer-section" style="margin-top: 10px;">
                  <strong class="drawer-heading">${escapeHtml(
                    d.exact_subfolders_heading(subs.length)
                  )}</strong>
                  <ul class="batch-folder-list">${subsHtml}</ul>
                </div>
              </div>

              <button
                type="button"
                class="btn btn-primary transfer-batch-btn"
                style="width: 100%;"
                data-batch-index="${idx}"
              >
                ${escapeHtml(d.transfer_this_batch_btn(formatBytes(b.total_bytes)))}
              </button>
            </div>
          </article>
        `;
      })
      .join("");

    batchesList.querySelectorAll(".batch-select-chk").forEach((chk) => {
      chk.addEventListener("change", () => {
        const idx = parseInt(chk.getAttribute("data-batch-index"), 10);
        if (chk.checked) {
          selectedBatchIndices.add(idx);
        } else {
          selectedBatchIndices.delete(idx);
        }
        updateMultiBatchSummary();
      });
    });

    batchesList.querySelectorAll(".toggle-batch-folders-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const panelId = btn.getAttribute("data-panel-id");
        const subCount = btn.getAttribute("data-sub-count");
        const panel = document.getElementById(panelId);
        if (!panel) return;
        const isExpanded = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", isExpanded ? "false" : "true");
        panel.classList.toggle("hidden", isExpanded);
        btn.textContent = isExpanded
          ? dict().show_batch_folders(formatNumber(Number(subCount)))
          : dict().hide_batch_folders(formatNumber(Number(subCount)));
      });
    });

    batchesList.querySelectorAll(".transfer-batch-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-batch-index"), 10);
        const batch = batches[idx];
        if (batch && batch.rel_paths) {
          startBatchTransfer(batch.rel_paths, translateServerBatchText(batch.title));
        }
      });
    });

    updateMultiBatchSummary();
  }

  // Botões de Seleção Rápida de Múltiplos Lotes
  document.querySelectorAll(".quick-select-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const count = parseInt(btn.getAttribute("data-select-count"), 10) || 5;
      const batches = (currentReport && currentReport.batches) || [];
      selectedBatchIndices.clear();
      for (let i = 0; i < Math.min(count, batches.length); i++) {
        selectedBatchIndices.add(i);
      }
      updateMultiBatchSummary();
    });
  });

  if (selectAllLocalBatchesBtn) {
    selectAllLocalBatchesBtn.addEventListener("click", () => {
      const batches = (currentReport && currentReport.batches) || [];
      selectedBatchIndices.clear();
      batches.forEach((b, idx) => {
        if (b.badge_type === "success") {
          selectedBatchIndices.add(idx);
        }
      });
      updateMultiBatchSummary();
    });
  }

  if (clearBatchSelectionBtn) {
    clearBatchSelectionBtn.addEventListener("click", () => {
      selectedBatchIndices.clear();
      updateMultiBatchSummary();
    });
  }

  if (transferSelectedBatchesBtn) {
    transferSelectedBatchesBtn.addEventListener("click", () => {
      const batches = (currentReport && currentReport.batches) || [];
      const sortedIndices = Array.from(selectedBatchIndices)
        .filter((i) => i >= 0 && i < batches.length)
        .sort((a, b) => a - b);

      if (!sortedIndices.length) return;

      const combinedPaths = [];
      sortedIndices.forEach((idx) => {
        if (batches[idx] && Array.isArray(batches[idx].rel_paths)) {
          combinedPaths.push(...batches[idx].rel_paths);
        }
      });

      if (combinedPaths.length) {
        startBatchTransfer(
          combinedPaths,
          dict().transfer_selected_label(sortedIndices.length)
        );
      }
    });
  }

  // Fila Ordenada + Filtros + Paginação
  function applyQueueFilters() {
    if (!currentReport) return;
    const allPending = currentReport.pending_files || [];
    const q = (queueSearch.value || "").trim().toLowerCase();
    const stageVal = queueStageFilter.value;
    const statusVal = queueStatusFilter.value;

    filteredPending = allPending.filter((item) => {
      if (stageVal !== "all" && String(item.stage) !== stageVal) return false;
      if (statusVal !== "all" && item.status !== statusVal) return false;
      if (q && !item.rel_path.toLowerCase().includes(q)) return false;
      return true;
    });

    queuePage = 1;
    renderQueueTable();
  }

  function renderQueueTable() {
    const d = dict();
    const total = filteredPending.length;
    const totalBytes = filteredPending.reduce((acc, i) => acc + (i.size || 0), 0);

    filteredCountBadge.textContent = formatNumber(total);
    transferFilteredBtn.disabled = total === 0;

    queueFilterSummary.textContent = d.queue_filter_summary(
      formatNumber(total),
      formatBytes(totalBytes)
    );

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (queuePage > totalPages) queuePage = totalPages;

    const startIdx = (queuePage - 1) * PAGE_SIZE;
    const slice = filteredPending.slice(startIdx, startIdx + PAGE_SIZE);

    queuePageInfo.textContent = d.page_info(queuePage, totalPages);
    queuePrevBtn.disabled = queuePage <= 1;
    queueNextBtn.disabled = queuePage >= totalPages;

    if (!slice.length) {
      queueTbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 24px;">
            ${escapeHtml(d.queue_empty)}
          </td>
        </tr>
      `;
      return;
    }

    queueTbody.innerHTML = slice
      .map((item) => {
        const storageBadge = item.local_available
          ? `<span class="badge badge-success">${escapeHtml(d.badge_local)}</span>`
          : `<span class="badge badge-info">${escapeHtml(d.badge_cloud)}</span>`;

        const statusBadge =
          item.status === "missing"
            ? `<span class="badge badge-warning">${escapeHtml(d.badge_missing)}</span>`
            : `<span class="badge badge-warning">${escapeHtml(d.badge_mismatch)}</span>`;

        return `
          <tr>
            <td><span class="order-pill">#${item.order}</span></td>
            <td>${storageBadge}</td>
            <td>${statusBadge}</td>
            <td class="mono">${escapeHtml(item.folder)}</td>
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td class="num-col">${formatBytes(item.size)}</td>
            <td>
              <button
                type="button"
                class="btn btn-outline btn-sm single-transfer-btn"
                data-rel-path="${escapeHtml(item.rel_path)}"
                aria-label="${escapeHtml(d.btn_copy_single_aria(item.name))}"
              >
                ${escapeHtml(d.btn_copy_single)}
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    queueTbody.querySelectorAll(".single-transfer-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const relPath = btn.getAttribute("data-rel-path");
        if (relPath) {
          startBatchTransfer([relPath], relPath);
        }
      });
    });
  }

  queueSearch.addEventListener("input", applyQueueFilters);
  queueStageFilter.addEventListener("change", applyQueueFilters);
  queueStatusFilter.addEventListener("change", applyQueueFilters);

  queuePrevBtn.addEventListener("click", () => {
    if (queuePage > 1) {
      queuePage--;
      renderQueueTable();
    }
  });

  queueNextBtn.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(filteredPending.length / PAGE_SIZE));
    if (queuePage < totalPages) {
      queuePage++;
      renderQueueTable();
    }
  });

  transferFilteredBtn.addEventListener("click", () => {
    if (!filteredPending.length) return;
    const paths = filteredPending.map((i) => i.rel_path);
    startBatchTransfer(paths, dict().filtered_selection_label(paths.length));
  });

  // Subpastas
  function renderFolders() {
    if (!currentReport) return;
    const d = dict();
    const allFolders = currentReport.folders || [];
    const q = (folderSearch.value || "").trim().toLowerCase();
    const filterVal = folderStatusFilter.value;

    const filtered = allFolders.filter((f) => {
      if (filterVal === "pending" && f.pending_files === 0) return false;
      if (filterVal === "complete" && f.pending_files > 0) return false;
      if (q && !f.folder.toLowerCase().includes(q)) return false;
      return true;
    });

    if (!filtered.length) {
      foldersTbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 24px;">
            ${escapeHtml(d.folders_empty)}
          </td>
        </tr>
      `;
      return;
    }

    foldersTbody.innerHTML = filtered
      .slice(0, 300)
      .map((f) => {
        const isDone = f.pending_files === 0;
        const badge = isDone
          ? `<span class="badge badge-success">${escapeHtml(d.badge_100_done)}</span>`
          : `<span class="badge badge-warning">${escapeHtml(
              d.badge_pct_done(f.completion_pct)
            )}</span>`;

        const actionHtml = isDone
          ? `<span class="help-text">${escapeHtml(d.folder_complete_text)}</span>`
          : `<button
               type="button"
               class="btn btn-primary btn-sm folder-transfer-btn"
               data-folder="${escapeHtml(f.folder)}"
             >
               ${escapeHtml(d.btn_transfer_folder(formatNumber(f.pending_files)))}
             </button>`;

        return `
          <tr>
            <th scope="row" class="mono">${escapeHtml(
              f.folder === "." ? d.root_folder_long : f.folder
            )}</th>
            <td>${badge}</td>
            <td class="num-col">${formatNumber(f.synced_files)} / ${formatNumber(f.total_files)}</td>
            <td class="num-col">${escapeHtml(
              d.loc_cloud_counts(
                formatNumber(f.local_pending_files),
                formatNumber(f.cloud_pending_files)
              )
            )}</td>
            <td class="num-col">${formatBytes(f.pending_bytes)}</td>
            <td>${actionHtml}</td>
          </tr>
        `;
      })
      .join("");

    foldersTbody.querySelectorAll(".folder-transfer-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const folderName = btn.getAttribute("data-folder");
        const folderFiles = (currentReport.pending_files || [])
          .filter((item) => item.folder === folderName)
          .map((item) => item.rel_path);
        if (folderFiles.length) {
          startBatchTransfer(folderFiles, folderName);
        }
      });
    });
  }

  folderSearch.addEventListener("input", renderFolders);
  folderStatusFilter.addEventListener("change", renderFolders);

  // Já Transferidos
  function renderSynced() {
    if (!currentReport) return;
    const d = dict();
    const allSynced = currentReport.synced_files || [];
    const q = (syncedSearch.value || "").trim().toLowerCase();

    const filtered = q
      ? allSynced.filter((i) => i.rel_path.toLowerCase().includes(q))
      : allSynced;

    syncedSummaryNote.textContent = d.synced_summary_note(formatNumber(filtered.length));

    const slice = filtered.slice(0, 200);
    if (!slice.length) {
      syncedTbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 24px;">
            ${escapeHtml(d.synced_empty)}
          </td>
        </tr>
      `;
      return;
    }

    syncedTbody.innerHTML = slice
      .map((item) => {
        const stateBadge = item.local_available
          ? `<span class="badge badge-info">${escapeHtml(d.badge_taking_local_space)}</span>`
          : `<span class="badge badge-success">${escapeHtml(d.badge_online_only_free)}</span>`;
        return `
          <tr>
            <td class="mono">${escapeHtml(item.folder)}</td>
            <td>${escapeHtml(item.name)}</td>
            <td class="num-col">${formatBytes(item.size)}</td>
            <td>${stateBadge}</td>
          </tr>
        `;
      })
      .join("");
  }

  syncedSearch.addEventListener("input", renderSynced);

  // Execução de Transferência por Lote
  async function startBatchTransfer(relPaths, batchLabel) {
    if (!relPaths || !relPaths.length) return;
    showError("");

    try {
      const res = await fetch("/api/transfer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rel_paths: relPaths,
          dehydrate_after_copy: dehydrateAfterCopyChk.checked,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error starting transfer.");
      }

      transferPanel.classList.remove("hidden");
      transferPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      transferStateText.textContent = dict().transferring_batch(batchLabel, relPaths.length);
      cancelTransferBtn.disabled = false;
      startTransferPolling();
    } catch (err) {
      showError(err.message);
    }
  }

  cancelTransferBtn.addEventListener("click", async () => {
    cancelTransferBtn.disabled = true;
    await fetch("/api/transfer/cancel", { method: "POST" });
  });

  function startTransferPolling() {
    if (transferPollTimer) clearInterval(transferPollTimer);
    transferPollTimer = setInterval(async () => {
      try {
        const res = await fetch("/api/transfer/status");
        const data = await res.json();
        const st = data.status || {};
        const d = dict();

        const doneFiles = st.completed_files || 0;
        const totalFiles = st.total_files || 0;
        const doneBytes = (st.transferred_bytes || 0) + (st.current_file_copied || 0);
        const totalBytes = st.total_bytes || 0;

        const pct =
          totalBytes > 0
            ? Math.min(100, Math.round((doneBytes / totalBytes) * 100))
            : totalFiles > 0
            ? Math.min(100, Math.round((doneFiles / totalFiles) * 100))
            : 0;

        const verFiles = st.verified_sha256_files || 0;
        transferCountsLabel.textContent = d.transfer_counts_status(
          formatNumber(doneFiles),
          formatNumber(totalFiles),
          formatNumber(verFiles),
          formatNumber(st.failed_files || 0)
        );
        transferBytesLabel.textContent = `${formatBytes(doneBytes)} / ${formatBytes(
          totalBytes
        )} (${pct}%)`;

        transferProgressbar.setAttribute("aria-valuenow", String(pct));
        transferProgressFill.style.width = `${pct}%`;

        const phaseTranslated = translateServerPhaseText(st.current_phase);
        const phasePrefix = phaseTranslated ? `[${phaseTranslated}] ` : "";
        transferCurrentFile.textContent = st.current_file
          ? `${phasePrefix}${st.current_file}`
          : phaseTranslated || "—";
        transferSpeed.textContent = st.speed_bps ? `${formatBytes(st.speed_bps)}/s` : "—";
        transferEta.textContent = data.running
          ? formatDuration(st.eta_seconds)
          : d.eta_completed;

        if (st.errors && st.errors.length > 0) {
          transferErrorsContainer.classList.remove("hidden");
          transferErrorsList.innerHTML = st.errors
            .map((e) => `<li><strong>${escapeHtml(e.rel_path)}:</strong> ${escapeHtml(e.error)}</li>`)
            .join("");
        } else {
          transferErrorsContainer.classList.add("hidden");
        }

        if (!data.running) {
          clearInterval(transferPollTimer);
          transferPollTimer = null;
          cancelTransferBtn.disabled = true;

          if (st.state === "completed") {
            transferStateText.textContent = d.transfer_completed_msg(formatNumber(doneFiles));
          } else if (st.state === "cancelled") {
            transferStateText.textContent = d.transfer_cancelled_msg(formatNumber(doneFiles));
          }

          await loadReport();
        }
      } catch (err) {
        console.error(err);
      }
    }, 600);
  }

  // Liberar espaço no OneDrive para arquivos já sincronizados
  freeSpaceBtn.addEventListener("click", async () => {
    const d = dict();
    const confirmed = window.confirm(d.free_space_confirm);
    if (!confirmed) return;

    freeSpaceBtn.disabled = true;
    const origText = freeSpaceBtn.textContent;
    freeSpaceBtn.textContent = d.free_space_btn_working;

    try {
      const res = await fetch("/api/onedrive/free-space", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error freeing space.");
      }
      window.alert(
        d.free_space_success(formatNumber(data.freed_count), formatBytes(data.freed_bytes))
      );
      await loadReport();
    } catch (err) {
      showError(err.message);
      freeSpaceBtn.disabled = false;
      freeSpaceBtn.textContent = origText;
    }
  });

  // Inicialização ao carregar a página
  async function init() {
    initAccessibleTabs();
    applyLanguage(currentLang);
    try {
      const res = await fetch("/api/defaults");
      const data = await res.json();
      if (data.source && !sourceInput.value) sourceInput.value = data.source;
      if (data.destination && !destInput.value) destInput.value = data.destination;
      if (data.scan_running) {
        startScanBtn.disabled = true;
        scanStatusBox.classList.remove("hidden");
        startScanPolling();
      } else {
        await loadReport();
      }
      if (data.transfer_running) {
        transferPanel.classList.remove("hidden");
        startTransferPolling();
      }
    } catch (err) {
      console.error("Error loading initial settings:", err);
    }
  }

  init();
})();
