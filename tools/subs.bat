@echo off
rem 윈도우에서 자막 등록: subs "C:\자막폴더" 이름
setlocal
if "%~2"=="" (
  echo 사용법: subs "자막폴더" 이름
  echo 예:     subs "C:\Users\bh\Desktop\자막" 병훈
  exit /b 1
)
where python >nul 2>nul
if %errorlevel%==0 (
  python "%~dp0add_subs.py" %1 --profile %2 %3 %4 %5
) else (
  py "%~dp0add_subs.py" %1 --profile %2 %3 %4 %5
)
