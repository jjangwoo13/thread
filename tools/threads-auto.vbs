' Threads auto task runner (2026-11-04). Arg: post | insights
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "D:\threads"
sh.Run """C:\Program Files\nodejs\node.exe"" ""D:\threads\tools\threads-api.js"" " & WScript.Arguments(0), 0, True
