# How Folder Scanning, Batch Ordering, and Space Freeing Work

Language / Idioma: [Portugues](funcionamento-e-ordem.md) | **English**  
Back to [Main README](../README.md).

---

## 1. Why copying through Windows Explorer freezes or takes too long

When you use OneDrive's space-saving feature (Files On-Demand), many files are not stored in full on your computer. Your computer only holds a placeholder with the file's name and size, while the actual content remains on Microsoft's servers.

If you select a large folder in Windows Explorer and copy it to Google Drive:
1. Windows tries to open all files at once.
2. OneDrive is forced to download every file over the internet before handing the data over to the copy process.
3. At the same time, the Google Drive desktop app tries to upload those files to Google's cloud.
4. Your local disk fills up with temporary cache files, causing the transfer to stall or fail midway.

---

## 2. How the program scans folders without downloading files

Every Windows file system keeps a directory index with basic information about each file: name, size in bytes, modification date, and status flags (called file attributes). This information is called **metadata**.

The program reads only this folder index without opening the file contents. Because the files are never opened during scanning, OneDrive does not trigger any downloads.

In addition, the program checks the Windows file attributes to determine whether each file is:
- **Already on the local disk:** The data is already stored on your computer and can be copied immediately without using the internet.
- **Cloud-only:** The file will need to be downloaded by OneDrive when its batch is copied.

---

## 3. Why scanning Google Drive takes longer than scanning OneDrive

- **OneDrive (`C:\Users\...\OneDrive`):** This is a standard folder stored directly on your main Windows drive (NTFS). Windows already has the directory index on disk, so scanning takes only a few seconds.
- **Google Drive (`G:\My Drive` or `G:\Meu Drive`):** This works as a virtual drive created by the Google Drive desktop app. When the assistant requests the file list for a subfolder in `G:`, Google Drive must query an internal database or ask Google's servers over the internet which files exist there. As a result, folders with thousands of subfolders take a few minutes during the first scan.

So you do not have to wait for a full scan every time, the program saves the scan results in `ultimo_relatorio_cache.json`. Whenever a batch finishes transferring, this cache file is updated immediately.

---

## 4. How the transfer order is organized

The program filters only the files that do not yet exist in Google Drive (or that have a different byte size) and organizes them into four phases:

1. **Phase 1 (Already on local disk):** Files already stored on the computer. They are copied first because they require no OneDrive download. They are grouped into batches of up to 500 files or 1 GB.
2. **Phase 2 (Cloud - up to 10 MB):** Small cloud-only files, ordered from the lightest subfolder to the heaviest.
3. **Phase 3 (Cloud - 10 MB to 100 MB):** Medium cloud-only files.
4. **Phase 4 (Cloud - over 100 MB):** Large cloud-only files left for last so they do not block the queue for smaller files.

Cloud files are grouped into batches of up to 250 files or 500 MB. During copying, the program recreates the exact same folder and subfolder structure in Google Drive.

---

## 5. How freeing up space on OneDrive works

When a cloud file is downloaded by OneDrive, it takes up space on your `C:` drive. Windows provides a built-in command (`attrib +U -P`) that tells OneDrive the file can return to "Online-only" status.

- **What this command does:** Removes the local copy from the `C:` drive to free up computer storage while keeping the file in your OneDrive cloud account.
- **When to use it:** Only if your `C:` drive is running low on free space. If your OneDrive account is over quota or about to be deactivated, do not use the free-space button so that downloaded files remain saved on both your computer and Google Drive.

---

Next topic: [Copy safety, SHA-256 verification, and audit logging](safety-and-verification.en.md).

