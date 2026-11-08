/**
 * Assistente de Migração OneDrive -> Google Drive
 * Lógica interativa do frontend (Acessível WCAG AA)
 */

(() => {
  "use strict";

  const PAGE_SIZE = 100;

  let currentReport = null;
  let filteredPending = [];
  let queuePage = 1;
  let scanPollTimer = null;
  let transferPollTimer = null;

  // Elementos do DOM
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
  let selectedBatchIndices = new Set();

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
    return `${val.toLocaleString("pt-BR", {
      minimumFractionDigits: i === 0 ? 0 : 1,
      maximumFractionDigits: i === 0 ? 0 : 2,
    })} ${units[i]}`;
  }

  function formatNumber(n) {
    return (n || 0).toLocaleString("pt-BR");
  }

  function formatDuration(sec) {
    if (sec === null || sec === undefined || !isFinite(sec) || sec < 0) return "Calculando...";
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
    const originalText = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = "Abrindo janela...";
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
      showError("Não foi possível abrir o seletor de pastas: " + err.message);
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = originalText;
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
      showError("Por favor, preencha os caminhos da pasta do OneDrive e da pasta do Google Drive.");
      return;
    }

    startScanBtn.disabled = true;
    scanStatusBox.classList.remove("hidden");
    scanStatusTitle.textContent = "Analisando pastas sem acionar downloads...";
    scanStatusDetail.textContent = "Iniciando leitura de metadados.";

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
        throw new Error(data.error || "Erro ao iniciar análise.");
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

        scanStatusTitle.textContent = prog.message || "Analisando...";
        scanStatusDetail.textContent = `Arquivos lidos — Origem (OneDrive): ${formatNumber(
          prog.source_scanned
        )} | Destino (Google Drive): ${formatNumber(prog.dest_scanned)}`;

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
      showError("Erro ao carregar relatório: " + err.message);
    }
  }

  function renderReport(report) {
    const s = report.summary;
    reportContainer.classList.remove("hidden");
    exportCsvBtn.classList.remove("hidden");

    summaryTimestamp.textContent = `Análise concluída em ${s.scanned_at} • Origem: ${s.source_dir} → Destino: ${s.dest_dir}`;

    const pctFiles = s.completion_files_pct || 0;
    const pctBytes = s.completion_bytes_pct || 0;
    overallPctStats.textContent = `${pctFiles}% dos arquivos (${formatNumber(
      s.synced_count
    )} de ${formatNumber(s.total_source_files)}) • ${pctBytes}% do volume (${formatBytes(
      s.synced_bytes
    )} de ${formatBytes(s.total_source_bytes)})`;
    overallProgressbar.setAttribute("aria-valuenow", String(Math.round(pctFiles)));
    overallProgressFill.style.width = `${Math.min(100, Math.max(0, pctFiles))}%`;

    kpiSyncedCount.textContent = formatNumber(s.synced_count);
    kpiSyncedBytes.textContent = `${formatBytes(s.synced_bytes)} confirmados no destino`;

    kpiPendingCount.textContent = formatNumber(s.pending_count);
    kpiPendingBytes.textContent = `${formatBytes(s.pending_bytes)} pendentes (${formatNumber(
      s.missing_count
    )} faltando, ${formatNumber(s.mismatch_count)} com tamanho diferente)`;

    kpiLocalPendingCount.textContent = formatNumber(s.local_pending_count);
    kpiLocalPendingBytes.textContent = `${formatBytes(
      s.local_pending_bytes
    )} prontos para cópia imediata`;

    kpiCloudPendingCount.textContent = formatNumber(s.cloud_pending_count);
    kpiCloudPendingBytes.textContent = `${formatBytes(
      s.cloud_pending_bytes
    )} precisam baixar do OneDrive`;

    if (s.synced_local_still_taking_space_count > 0) {
      freeSpaceBtn.disabled = false;
      freeSpaceBtn.textContent = `Liberar ${formatBytes(
        s.synced_local_still_taking_space_bytes
      )} no OneDrive (${formatNumber(s.synced_local_still_taking_space_count)} arquivos já copiados)`;
    } else {
      freeSpaceBtn.disabled = true;
      freeSpaceBtn.textContent = "Nenhum espaço extra de arquivos já copiados para liberar";
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
      multiBatchSummary.textContent =
        "Nenhum lote selecionado (marque os cards abaixo ou use os botões rápidos)";
      transferSelectedBatchesBtn.disabled = true;
      transferSelectedBatchesBtn.textContent = "🚀 Transferir Lotes Selecionados (0)";
    } else {
      multiBatchSummary.textContent = `${formatNumber(
        count
      )} lote(s) selecionado(s) • ${formatNumber(totalFiles)} arquivo(s) • ${formatBytes(
        totalBytes
      )}`;
      transferSelectedBatchesBtn.disabled = false;
      transferSelectedBatchesBtn.textContent = `🚀 Transferir Lotes Selecionados (${formatNumber(
        count
      )} lotes • ${formatBytes(totalBytes)})`;
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
    selectedBatchIndices.clear();
    if (!batches.length) {
      batchesList.innerHTML = `
        <div class="kpi-card kpi-success" style="grid-column: 1 / -1;">
          <strong>Parabéns! Todos os arquivos da pasta de origem já estão transferidos e verificados na pasta de destino.</strong>
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

        const rootsHtml = roots
          .map(
            (r) =>
              `<li class="batch-folder-item">
                 <span class="mono"><strong>${escapeHtml(r.folder)}</strong></span>
                 <span class="batch-folder-meta">${formatNumber(r.count)} arq. &bull; ${formatBytes(
                r.bytes
              )}</span>
               </li>`
          )
          .join("");

        const subsHtml = subs
          .map(
            (sf) =>
              `<li class="batch-folder-item">
                 <span class="mono">${escapeHtml(sf.folder === "." ? "(Raiz)" : sf.folder)}</span>
                 <span class="batch-folder-meta">${formatNumber(sf.count)} arq. &bull; ${formatBytes(
                sf.bytes
              )}</span>
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
                <span>Selecionar este lote (${idx + 1}º Passo)</span>
              </label>

              <div class="batch-top">
                <span class="badge ${badgeClass}">${escapeHtml(iconText)} ${escapeHtml(
          b.badge
        )}</span>
                <span class="order-pill">${idx + 1}º Passo</span>
              </div>
              <h4 class="batch-title">${escapeHtml(b.title)}</h4>
              <p class="batch-desc">${escapeHtml(b.description)}</p>
            </div>

            <div>
              <div class="batch-stats" style="margin-bottom: 10px;">
                <span>📁 ${formatNumber(b.file_count)} arquivo(s)</span>
                <span>📂 ${formatNumber(subCount)} subpasta(s)</span>
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
                📂 Ver pastas deste lote (${formatNumber(subCount)})
              </button>

              <div
                id="${panelId}"
                class="batch-folders-drawer hidden"
                role="region"
                aria-label="Pastas incluídas no ${escapeHtml(b.title)}"
              >
                <div class="drawer-section">
                  <strong class="drawer-heading">Pastas Principais (${roots.length}):</strong>
                  <ul class="batch-folder-list">${rootsHtml}</ul>
                </div>
                <div class="drawer-section" style="margin-top: 10px;">
                  <strong class="drawer-heading">Subpastas Exatas (${subs.length}):</strong>
                  <ul class="batch-folder-list">${subsHtml}</ul>
                </div>
              </div>

              <button
                type="button"
                class="btn btn-primary transfer-batch-btn"
                style="width: 100%;"
                data-batch-index="${idx}"
              >
                Transferir Este Lote Agora (${formatBytes(b.total_bytes)})
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
          ? `📂 Ver pastas deste lote (${formatNumber(Number(subCount))})`
          : `📂 Ocultar pastas deste lote (${formatNumber(Number(subCount))})`;
      });
    });

    batchesList.querySelectorAll(".transfer-batch-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-batch-index"), 10);
        const batch = batches[idx];
        if (batch && batch.rel_paths) {
          startBatchTransfer(batch.rel_paths, batch.title);
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
          `${sortedIndices.length} Lote(s) Selecionado(s)`
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
    const total = filteredPending.length;
    const totalBytes = filteredPending.reduce((acc, i) => acc + (i.size || 0), 0);

    filteredCountBadge.textContent = formatNumber(total);
    transferFilteredBtn.disabled = total === 0;

    queueFilterSummary.textContent = `Exibindo ${formatNumber(
      total
    )} arquivo(s) pendente(s) somando ${formatBytes(totalBytes)}.`;

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (queuePage > totalPages) queuePage = totalPages;

    const startIdx = (queuePage - 1) * PAGE_SIZE;
    const slice = filteredPending.slice(startIdx, startIdx + PAGE_SIZE);

    queuePageInfo.textContent = `Página ${queuePage} de ${totalPages}`;
    queuePrevBtn.disabled = queuePage <= 1;
    queueNextBtn.disabled = queuePage >= totalPages;

    if (!slice.length) {
      queueTbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 24px;">
            Nenhum arquivo pendente corresponde aos filtros selecionados.
          </td>
        </tr>
      `;
      return;
    }

    queueTbody.innerHTML = slice
      .map((item) => {
        const storageBadge = item.local_available
          ? `<span class="badge badge-success">✔ Local (No disco)</span>`
          : `<span class="badge badge-info">☁ Apenas Nuvem</span>`;

        const statusBadge =
          item.status === "missing"
            ? `<span class="badge badge-warning">Faltando no destino</span>`
            : `<span class="badge badge-warning">Tamanho diferente</span>`;

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
                aria-label="Transferir arquivo ${escapeHtml(item.name)}"
              >
                Copiar
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
          startBatchTransfer([relPath], `Arquivo: ${relPath}`);
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
    startBatchTransfer(paths, `Seleção Filtrada (${paths.length} arquivos)`);
  });

  // Subpastas
  function renderFolders() {
    if (!currentReport) return;
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
            Nenhuma subpasta encontrada para este filtro.
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
          ? `<span class="badge badge-success">✔ 100% Concluída</span>`
          : `<span class="badge badge-warning">${f.completion_pct}% concluída</span>`;

        const actionHtml = isDone
          ? `<span class="help-text">Completa</span>`
          : `<button
               type="button"
               class="btn btn-primary btn-sm folder-transfer-btn"
               data-folder="${escapeHtml(f.folder)}"
               aria-label="Transferir pendências da subpasta ${escapeHtml(f.folder)}"
             >
               Transferir Pasta (${formatNumber(f.pending_files)})
             </button>`;

        return `
          <tr>
            <th scope="row" class="mono">${escapeHtml(
              f.folder === "." ? "(Raiz da pasta)" : f.folder
            )}</th>
            <td>${badge}</td>
            <td class="num-col">${formatNumber(f.synced_files)} / ${formatNumber(f.total_files)}</td>
            <td class="num-col">${formatNumber(f.local_pending_files)} locais / ${formatNumber(
          f.cloud_pending_files
        )} nuvem</td>
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
          startBatchTransfer(folderFiles, `Subpasta: ${folderName}`);
        }
      });
    });
  }

  folderSearch.addEventListener("input", renderFolders);
  folderStatusFilter.addEventListener("change", renderFolders);

  // Já Transferidos
  function renderSynced() {
    if (!currentReport) return;
    const allSynced = currentReport.synced_files || [];
    const q = (syncedSearch.value || "").trim().toLowerCase();

    const filtered = q
      ? allSynced.filter((i) => i.rel_path.toLowerCase().includes(q))
      : allSynced;

    syncedSummaryNote.textContent = `Total de ${formatNumber(
      filtered.length
    )} arquivo(s) confirmado(s) no destino (exibindo até 200 linhas).`;

    const slice = filtered.slice(0, 200);
    if (!slice.length) {
      syncedTbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 24px;">
            Nenhum arquivo transferido encontrado para este filtro.
          </td>
        </tr>
      `;
      return;
    }

    syncedTbody.innerHTML = slice
      .map((item) => {
        const stateBadge = item.local_available
          ? `<span class="badge badge-info">Ocupando espaço local no OneDrive</span>`
          : `<span class="badge badge-success">Apenas online no OneDrive (Espaço livre)</span>`;
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
        throw new Error(data.error || "Não foi possível iniciar a transferência.");
      }

      transferPanel.classList.remove("hidden");
      transferPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      transferStateText.textContent = `Transferindo ${batchLabel} (${relPaths.length} arquivos)...`;
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
        transferCountsLabel.textContent = `${formatNumber(doneFiles)} de ${formatNumber(
          totalFiles
        )} concluídos • 🔒 ${formatNumber(verFiles)} verificados com SHA-256 (${formatNumber(
          st.failed_files || 0
        )} falhas)`;
        transferBytesLabel.textContent = `${formatBytes(doneBytes)} / ${formatBytes(
          totalBytes
        )} (${pct}%)`;

        transferProgressbar.setAttribute("aria-valuenow", String(pct));
        transferProgressFill.style.width = `${pct}%`;

        const phasePrefix = st.current_phase ? `[${st.current_phase}] ` : "";
        transferCurrentFile.textContent = st.current_file
          ? `${phasePrefix}${st.current_file}`
          : st.current_phase || "—";
        transferSpeed.textContent = st.speed_bps ? `${formatBytes(st.speed_bps)}/s` : "—";
        transferEta.textContent = data.running ? formatDuration(st.eta_seconds) : "Concluído";

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
            transferStateText.textContent = `Lote finalizado! ${formatNumber(
              doneFiles
            )} arquivo(s) transferido(s) e verificado(s) bit a bit com hash SHA-256.`;
          } else if (st.state === "cancelled") {
            transferStateText.textContent = `Transferência interrompida com segurança após ${formatNumber(
              doneFiles
            )} arquivo(s). Nenhum arquivo parcial ficou corrompido.`;
          }

          // Atualiza o relatório instantaneamente (já atualizado na memória e no cache pelo servidor)
          await loadReport();
        }
      } catch (err) {
        console.error(err);
      }
    }, 600);
  }

  // Liberar espaço no OneDrive para arquivos já sincronizados
  freeSpaceBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Deseja marcar como 'Apenas online' no OneDrive os arquivos que JÁ foram confirmados com o mesmo tamanho no Google Drive?\n\nIsso libera espaço no seu computador sem apagar nada da nuvem do OneDrive."
    );
    if (!confirmed) return;

    freeSpaceBtn.disabled = true;
    const origText = freeSpaceBtn.textContent;
    freeSpaceBtn.textContent = "Liberando espaço local no OneDrive...";

    try {
      const res = await fetch("/api/onedrive/free-space", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao liberar espaço.");
      }
      window.alert(
        `Espaço liberado com sucesso!\n\nArquivos convertidos para 'Apenas online': ${formatNumber(
          data.freed_count
        )}\nEspaço liberado no disco: ${formatBytes(data.freed_bytes)}`
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
      console.error("Erro ao carregar configurações iniciais:", err);
    }
  }

  init();
})();

