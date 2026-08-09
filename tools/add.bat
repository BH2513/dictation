@echo off
rem 윈도우에서 영상 등록: add "유튜브주소" 이름
setlocal
if "%~2"=="" (
  echo 사용법: add "유튜브주소" 이름
  echo 예:     add "https://www.youtube.com/watch?v=SW2bVwdr8Zg" 병훈
  exit /b 1
)
where python >nul 2>nul
if %errorlevel%==0 (
  python "%~dp0add_video.py" %1 --profile %2 %3 %4 %5
) else (
  py "%~dp0add_video.py" %1 --profile %2 %3 %4 %5
)
