# mklink export

Generated at: `2026-05-02 17:16:39`

说明：

- 这份文件用于人工浏览和复制命令，不会自动执行。
- 以 `:: DISABLED` 开头的命令来自未启用配置，默认不要执行。
- 执行前请确认目标位置没有需要保留的真实内容。

```bat
@echo off
setlocal
set "MAPPING_ROOT_TOOL=tools\mklink-by-Mapping-Root.bat"
:: 可把 MAPPING_ROOT_TOOL 改成 mklink-by-Mapping-Root.bat 的实际位置

::::::::::::::::::::::::::::::::::::
::::: 1. Data Repo: Primary Data Repo
::::::::::::::::::::::::::::::::::::
:: id: primary
:: path: D:\A\resticprofile\thirdparty_configs\mklink
:: User profile
call "%MAPPING_ROOT_TOOL%" "D:\A\resticprofile\thirdparty_configs\mklink\me" "C:\Users\i" "MANUAL" "test-1-no-exist;test2-no-exist"
:: AppData Local
call "%MAPPING_ROOT_TOOL%" "D:\A\resticprofile\thirdparty_configs\mklink\AppData_Local" "C:\Users\i\AppData\Local" "MANUAL" "test-1-no-exist;test2-no-exist"
:: AppData Roaming
call "%MAPPING_ROOT_TOOL%" "D:\A\resticprofile\thirdparty_configs\mklink\Roaming" "C:\Users\i\AppData\Roaming" "MANUAL" "Wox;Anki2"
:: Roaming Microsoft
call "%MAPPING_ROOT_TOOL%" "D:\A\resticprofile\thirdparty_configs\mklink\Roaming-Microsoft\Microsoft" "C:\Users\i\AppData\Roaming\Microsoft" "MANUAL" ""

::::::::::::::::::::::::::::::::::::
::::: 2. Free links: primary
::::::::::::::::::::::::::::::::::::
:: explicit one-to-one mappings under a Data Repo
:: Run folder
mklink /d "D:\a\Run" "D:\A\resticprofile\thirdparty_configs\mklink\Run"

::::::::::::::::::::::::::::::::::::
::::: 3. 自由链接(源不在 Data Repo)
::::::::::::::::::::::::::::::::::::
:: source path is outside configured Data Repos
:: dwhelper
:: SOURCE MISSING mklink /d "C:\Users\i\dwhelper" "E:\i\Documents\dwhelper"
:: AppData Local Programs
mklink /d "C:\Users\i\AppData\Local\Programs" "d:\Local\Programs"
:: espanso
mklink /d "C:\Users\i\AppData\Roaming\espanso" "D:\A\Scoop\persist\Espanso\.espanso"
:: Anki2
mklink /d "C:\Users\i\AppData\Roaming\Anki2" "D:\A\Scoop\persist\anki\data"
:: .gradle
:: SOURCE MISSING mklink /d "C:\Users\i\.gradle" "O:\Users\z\.gradle"
:: .android
:: SOURCE MISSING mklink /d "C:\Users\i\.android" "O:\Users\z\.android"

endlocal
```
