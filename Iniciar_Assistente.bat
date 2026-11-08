@echo off
chcp 65001 >nul
title Assistente de Migracao OneDrive para Google Drive
cd /d "%~dp0"
echo Iniciando o Assistente de Migracao OneDrive -^> Google Drive...
python "%~dp0sync_assistant.py"
pause

