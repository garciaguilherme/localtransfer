# Local Transfer: OneDrive to Google Drive

Language / Idioma: **English** | [Portugues](README.pt.md)

---

Local tool to compare OneDrive and Google Drive folders on Windows, plan the transfer order, and copy files in batches with cryptographic integrity verification (SHA-256).

## Requirements

1. Windows 10 or Windows 11.
2. Python 3.9 or newer installed (uses only the Python standard library, with no external packages required).
3. OneDrive and Google Drive desktop applications configured on the computer.

## Getting Started

### Option 1: Windows shortcut

Double-click `Iniciar_Assistente.bat`. Your browser will open at the local dashboard address:

`http://127.0.0.1:19845/migracao`

### Option 2: Terminal (PowerShell or Command Prompt)

From the project folder, run:

```powershell
python sync_assistant.py
```

To stop the program, close the terminal window or press `Ctrl + C`.

## How to Use

1. **Select folders:** Enter the source folder path (OneDrive) and destination folder path (Google Drive), or click **Procurar** (Browse) to choose them.
2. **Analyze differences:** Click **Analisar Diferencas e Gerar Ordem** (Analyze Differences and Generate Order). The program reads the file list from both folders without triggering OneDrive downloads.
3. **Choose batches:** In the **Lotes Recomendados** (Recommended Batches) tab, inspect which folders belong to each batch by clicking **Ver pastas deste lote** (View folders in this batch).
4. **Transfer:** Click **Transferir Este Lote Agora** (Transfer This Batch Now) to copy a single batch, or select multiple batches and click **Transferir Lotes Selecionados** (Transfer Selected Batches).
5. **Review audit log:** Every copied file is recorded in `logs/auditoria_transferencias.csv`.

## File Structure

- `Iniciar_Assistente.bat`: Windows launcher script for the local server.
- `sync_assistant.py`: Local web server, folder scanner, and batch file copier.
- `static/index.html`: Web interface structure (WCAG 2.1 AA accessibility compliant).
- `static/styles.css`: Page stylesheet (Material Design 3).
- `static/app.js`: UI controls, batch selection, and server communication.
- `ultimo_relatorio_cache.json`: Local report cache (ignored by Git) so the app can resume progress without rescanning all folders on startup.
- `logs/auditoria_transferencias.csv`: Local audit log (ignored by Git) of all transferred and verified files.

## Detailed Documentation

To understand the technical concepts behind the tool in plain language, see the guides below:

- [How folder scanning, batch ordering, and space freeing work](docs/how-it-works-and-batching.en.md)
- [Copy safety, SHA-256 verification, and audit logging](docs/safety-and-verification.en.md)

## Disclaimer

This code was developed with the assistance of Artificial Intelligence (AI). It is provided "as is", without warranty of any kind. Use it at your own risk. Always verify your backups before deleting any original files.
