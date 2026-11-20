@echo off
chcp 65001 >nul
setlocal
rem Repair a HarGlobal/HarScience profile whose plugin was installed from a local directory.
rem Ships beside the app: node and the profile are both found relative to this file.
set "TOOLS=%~dp0"
set "NODE=%TOOLS%..\runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%TOOLS%fix-link.mjs" %*
