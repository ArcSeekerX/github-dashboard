@echo off
REM Windows 启动脚本
cd /d "%~dp0"

if not exist config.json (
  echo [start] config.json 不存在，从 config.example.json 拷贝
  copy config.example.json config.json >nul
  echo [start] 请先编辑 config.json 填入 GitHub token 与 username，然后重新执行 start.cmd
  exit /b 1
)

if not exist node_modules (
  echo [start] 首次运行，正在安装依赖…
  call npm install --no-audit --no-fund
)

REM 公司网络代理（默认走 xfusion 代理，可用 set HTTPS_PROXY=... 覆盖）
if "%HTTPS_PROXY%"=="" set HTTPS_PROXY=http://proxy.xfusion.com:8080

node server.js
