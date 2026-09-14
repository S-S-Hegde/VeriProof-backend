$projectDir = "d:\fullstack workshop\main project"
Set-Location $projectDir

$env:PATH = "C:\Users\shrid\TinyTeX\TinyTeX\bin\windows;" + $env:PATH

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "Compiling SDMIT ISE Project Report (main.tex)..." -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

pdflatex -interaction=nonstopmode main.tex
bibtex main
pdflatex -interaction=nonstopmode main.tex
pdflatex -interaction=nonstopmode main.tex

if (Test-Path "$projectDir\main.pdf") {
    Write-Host "`n===================================================" -ForegroundColor Green
    Write-Host "SUCCESS: main.pdf built successfully!" -ForegroundColor Green
    Write-Host "Location: $projectDir\main.pdf" -ForegroundColor Green
    Write-Host "===================================================" -ForegroundColor Green
} else {
    Write-Host "`nERROR: Build failed. Check main.log." -ForegroundColor Red
}
