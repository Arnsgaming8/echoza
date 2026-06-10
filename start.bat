@echo off
cd /d "%~dp0server"
start /B npx tsx src/index.ts > ..\server.log 2>&1
echo Server started on port 3001

cd /d "%~dp0client"
start /B npx vite --port 5173 > ..\client.log 2>&1
echo Client started on port 5173

echo.
echo Echoza is running!
echo Client: http://localhost:5173
echo Server: http://localhost:3001
