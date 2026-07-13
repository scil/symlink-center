:::::::::::::::::::::::::::::::::::: 
:::::::::::::::::::::::::::::::::::: 
::::: 自由链接
:::::::::::::::::::::::::::::::::::: 
:::::::::::::::::::::::::::::::::::: 

mklink /d C:\Users\i\dwhelper\ E:\i\Documents\dwhelper\

:: 为什么删不掉
::rmdir /s /q  C:\Users\i\AppData\Roaming\Microsoft\Windows\
::mklink /d C:\Users\i\AppData\Roaming\Microsoft\Windows\ D:\A\resticprofile\thirdparty_configs\mklink\Roaming-Microsoft\Microsoft\Windows\

rmdir /s /q C:\Users\i\AppData\Local\Programs
mklink /d C:\Users\i\AppData\Local\Programs d:\Local\Programs

:: scoop -> Roaming
mklink /d C:\Users\i\AppData\Roaming\espanso D:\A\Scoop\persist\Espanso\.espanso
mklink /d C:\Users\i\AppData\Roaming\Anki2  D:\A\Scoop\persist\anki\data

:: 只是为了节省空间
mklink /d C:\Users\i\.gradle  O:\Users\z\.gradle
mklink /d C:\Users\i\.android  O:\Users\z\.android

:::::::::::::::::::::::::::::::::::: 
:::::::::::::::::::::::::::::::::::: 
::::: Primary Data Repo
:::::::::::::::::::::::::::::::::::: 
:::::::::::::::::::::::::::::::::::: 

mklink /d D:\a\Run D:\A\resticprofile\thirdparty_configs\mklink\Run

::: 手动创建
mklink /d C:\Users\i\.codex\  D:\A\resticprofile\thirdparty_configs\mklink\me\.codex\

:::::::::::::::::::::::::::::::::::: 
::::: 调用 mklink-by-Mapping-Root.bat 脚本 自动根据  Mapping Root文件夹的结构 创建软链接
:::::::::::::::::::::::::::::::::::: 
::: 根据备份文件夹 D:\A\resticprofile\thirdparty_configs\mklink 里的结构，自动创建 mklink
:::: ⊙============================================================
::: 0. 示例
::: 指定模式（AUTO: 自动删除目标位置上的已有同名项目 并建立软链接）
:::   mklink-by-Mapping-Root.bat "D:\MyBack" "C:\Users\Admin" "AUTO"
::: 完整调用（包含忽略列表）
::    mklink-by-Mapping-Root.bat  "D:\MyBack" "C:\Users\Admin" "AUTO" ".git;.vscode;readme.txt"
::: 在另一个脚本中调用
::::    call mklink-by-Mapping-Root.bat "D:\MyBack\Nginx" "C:\Server\Nginx" "MANUAL" "logs;temp"
:::: ============================================================

:::: ⊙============================================================
::: 1. 用户配置目录下的一级子目录和文件（发现：重装系统 保留用户文件 居然会保留这里的）
::: 备注：
:::   vfox: 跨平台版本、支持多语言的版本管理工具——vfox，让你无忧应对多编程语言、不同版本的开发环境
D:\A\resticprofile\thirdparty_configs\mklink-bat\mklink-by-Mapping-Root.bat  "D:\A\resticprofile\thirdparty_configs\mklink\me"   "C:\Users\i"   "MANUAL"  "test-1-no-exist;test2-no-exist"
:::: ⊙============================================================

::: 2. AppData\Local
D:\A\resticprofile\thirdparty_configs\mklink-bat\mklink-by-Mapping-Root.bat  "D:\A\resticprofile\thirdparty_configs\mklink\AppData_Local"   "C:\Users\i\AppData\Local"   "MANUAL"  "test-1-no-exist;test2-no-exist"


:::: ⊙============================================================
::::::3. AppData\Roaming
::::::::::::::::::
D:\A\resticprofile\thirdparty_configs\mklink-bat\mklink-by-Mapping-Root.bat  "D:\A\resticprofile\thirdparty_configs\mklink\Roaming"   "C:\Users\i\AppData\Roaming"   "MANUAL"  "Wox;Anki2"


:::: ⊙============================================================
::::::4. 
::::::::::::::::::
