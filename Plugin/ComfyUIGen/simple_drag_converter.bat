@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

REM ComfyUI工作流拖放转换器 V3 

title ComfyUI 工作流拖放转换器 V3
color 0A

REM 获取脚本所在目录
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

REM 创建必要的目录
if not exist "workflows" mkdir "workflows"
if not exist "backups" mkdir "backups"
if not exist "output" mkdir "output"

echo +============================================+
echo ^|     ComfyUI 工作流拖放转换器 V3            ^|
echo ^|   请确保你的工作流节点标题包含白名单关键字 ^|
echo ^|     请在whitelist.txt中编辑替换节点关键字  ^|
echo +============================================+
echo ^|  直接拖放文件到此窗口或BAT图标上           ^|
echo +============================================+
echo.

REM 检查Node.js是否安装
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未找到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

REM 检查是否有拖放的文件
if "%~1"=="" (
    echo 请拖放一个或多个 JSON 文件到此窗口
    echo.
    set /p INPUT_FILE=或输入文件路径: 
    
    if "!INPUT_FILE!"=="" (
        echo 没有输入文件，退出...
        pause
        exit /b
    )
    
    REM 移除引号
    set INPUT_FILE=!INPUT_FILE:"=!
    
    REM 调用转换
    call :convert_file "!INPUT_FILE!"
    
    echo.
    echo 完成！
    pause
    exit /b
)

REM 处理拖放的文件
:process_loop
if "%~1"=="" goto :done

echo ============================================
echo 处理文件: %~nx1
echo.

call :convert_file "%~1"

shift
goto :process_loop

:convert_file
REM 获取完整路径和文件名
set "INPUT_PATH=%~f1"
set "FILE_NAME=%~n1"
set "FILE_EXT=%~x1"

REM 检查是否为JSON文件
if /i not "!FILE_EXT!"==".json" (
    echo ⚠️  跳过: 不是 JSON 文件
    exit /b
)

REM 检查文件是否存在
if not exist "!INPUT_PATH!" (
    echo ❌ 错误: 文件不存在
    exit /b
)

REM 生成输出文件名
set "OUTPUT_FILE=workflows\%FILE_NAME%-template.json"

echo 📁 输入: !INPUT_PATH!
echo 📁 输出: !OUTPUT_FILE!
echo.

REM 调用 V3 版本的 CLI
echo 🔄 转换中...
node "%SCRIPT_DIR%workflow-template-cli.js" convert "!INPUT_PATH!" "!OUTPUT_FILE!"

if errorlevel 1 (
    echo.
    echo ❌ 转换失败
) else (
    echo.
    echo ✅ 转换成功！
    
    REM 分析模板
    echo.
    echo 📊 分析结果:
    node "%SCRIPT_DIR%workflow-template-cli.js" analyze "!INPUT_PATH!" 2>nul | findstr /C:"总节点数" /C:"匹配白名单" /C:"替换的字段"
    
    REM 备份原始文件
    copy /y "!INPUT_PATH!" "backups\%FILE_NAME%_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%.json" >nul 2>&1
    if not errorlevel 1 (
        echo.
        echo 📋 原始文件已备份
    )
)

echo.
exit /b

:done
echo ============================================
echo.
echo ✨ 所有文件处理完成！
echo.
echo 📁 模板文件位置: %SCRIPT_DIR%workflows\
echo 📁 备份位置: %SCRIPT_DIR%backups\
echo 📋 白名单配置: %SCRIPT_DIR%whitelist.txt
echo.
echo 提示: 可以编辑 whitelist.txt 来修改处理规则
echo.
pause
exit /b