# Copy Safety, SHA-256 Verification, and Audit Logging

Language / Idioma: [Portugues](seguranca-e-verificacao.md) | **English**  
Back to [Main README](../README.md) or see [How folder scanning and batch ordering work](how-it-works-and-batching.en.md).

---

## 1. What SHA-256 is and why it is used

When you copy a file from one location to another, checking only whether the filename and byte size match does not guarantee that the entire content was written without errors. If a disk or network glitch occurs while writing, a file may end up with the right size but contain corrupted data inside.

**SHA-256** (256-bit Secure Hash Algorithm) works like a **mathematical fingerprint** of the file:
- The program reads every byte of the file from start to finish and applies a mathematical formula that produces a unique 64-character code of letters and numbers (for example: `8f0690c3d88ab8f6...`).
- If even a single letter, pixel, or bit in the file changes, the resulting SHA-256 code will be completely different.
- Two files will only have the same SHA-256 code if their contents are identical from the first byte to the last.

### How the program uses SHA-256 during copying:
1. While reading the original file from OneDrive, the program calculates the source SHA-256.
2. After writing the copy to Google Drive, the program reopens the newly written file in Google Drive, reads all its bytes from disk, and calculates the destination SHA-256.
3. The program compares both codes. A file transfer is only marked as complete if both the byte size and the source and destination SHA-256 codes match.

---

## 2. What temporary file copying (`.sync_part`) is

If a power outage or network drop interrupts a standard file copy, the destination file is left half-written. On the next attempt, it is hard to tell whether that file is complete or truncated.

To prevent this problem, the program uses an **atomic copy** process:
1. While a file is being copied, it is written to a short temporary name in the format `.sync_tmp_<code>.sync_part`.
2. The program ignores any file ending in `.sync_part` when checking which files have already been transferred.
3. Only after all bytes are flushed to disk (`fsync`) and the SHA-256 code is verified is the temporary file renamed to its final filename.
4. If the transfer is interrupted at any point, the incomplete `.sync_part` file is automatically deleted, leaving no corrupted files in your Google Drive folder.

---

## 3. Protection against data loss or overwriting

- **Your OneDrive folder is never modified or deleted:** The program opens OneDrive files in read-only mode. No delete commands are ever executed on the source folder.
- **Automatic backup on size conflicts:** If a file with the same name already exists in Google Drive but has a different byte size than the OneDrive file, the program does not overwrite it. Instead, it first moves the older Google Drive file into a separate backup folder named `_Backup_Versoes_Conflito` (stamped with the date and time) and then writes the newly verified version.
- **Support for long filenames and Japanese/CJK characters:** The Google Drive virtual drive (`G:`) enforces a 255-byte (UTF-8) limit per filename. Because Japanese, Chinese, or Korean characters take 3 bytes each in UTF-8, long filenames could otherwise be rejected by Google Drive. The program automatically shortens only the filenames that exceed this byte limit while preserving the file extension.

---

## 4. Automatic retries and free disk space protection

- **Three attempts per file:** When downloading cloud-only files from OneDrive, the network connection may fluctuate. If a copy fails, the program deletes the temporary file, waits a few seconds (2s, 5s, and 10s), and retries up to three times before logging an error.
- **Preventive pause on low disk space:** Both OneDrive and Google Drive use your computer's local drive as a staging area when downloading and uploading files. Before copying each file, the program checks that at least **5 GB of free space** is available on both the source and destination drives. If free space drops below 5 GB, the transfer stops safely so you can wait for Google Drive to finish uploading.

---

## 5. How to inspect the audit log

Every file transfer performed by the program is recorded in:

`logs/auditoria_transferencias.csv`

You can also download this file by clicking the **Baixar Log de Auditoria (SHA-256)** button at the top of the assistant page. It can be opened in Excel, LibreOffice Calc, or Notepad and contains the following columns for each file:

- **Data_Hora:** Exact timestamp when the file finished copying.
- **Status_Auditoria:** Shows `VERIFICADO_SHA256_OK` when the copy passed the integrity check.
- **Caminho_Relativo:** Relative folder path and filename.
- **Tamanho_Bytes:** Exact file size in bytes.
- **SHA256_Origem:** Fingerprint calculated from the source file in OneDrive.
- **SHA256_Destino:** Fingerprint verified from the destination file written to Google Drive.
- **Tentativas:** Number of attempts required (normally `1`).
- **Observacao:** Confirmation details or error message if the file could not be read.

