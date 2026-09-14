@echo off
setlocal
cd /d "d:\fullstack workshop\main project"
set "PATH=C:\Users\shrid\TinyTeX\TinyTeX\bin\windows;%PATH%"

echo ===================================================
echo Compiling SDMIT ISE Project Report (main.tex)...
echo ===================================================

pdflatex -interaction=nonstopmode main.tex
bibtex main
pdflatex -interaction=nonstopmode main.tex
pdflatex -interaction=nonstopmode main.tex

if exist "main.pdf" (
    echo.
    echo ===================================================
    echo SUCCESS: main.pdf built successfully!
    echo Location: d:\fullstack workshop\main project\main.pdf
    echo ===================================================
) else (
    echo.
    echo ERROR: Build failed. Please check main.log for details.
)
pause
