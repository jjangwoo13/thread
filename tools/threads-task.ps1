# 작업 스케줄러에 Threads 자동 작업 등록 (2026-11-04)
# ThreadsAutoPost: 30분마다 예약글.json에서 시간이 된 글 게시
# ThreadsInsights: 매일 23:50 팔로워·글별 반응을 인사이트기록.md에 추가
# PC가 꺼져 있다 켜지면 놓친 실행 1번 바로 함.
# 실행: powershell -ExecutionPolicy Bypass -File D:\threads\tools\threads-task.ps1
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew

$post = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"D:\threads\tools\threads-auto.vbs" post' -WorkingDirectory 'D:\threads'
$every30 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName 'ThreadsAutoPost' -Action $post -Trigger $every30 -Settings $settings -Description 'Threads 예약글 게시 (D:\threads\예약글.json)' -Force | Out-Null

$ins = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"D:\threads\tools\threads-auto.vbs" insights' -WorkingDirectory 'D:\threads'
$daily = New-ScheduledTaskTrigger -Daily -At '23:50'
Register-ScheduledTask -TaskName 'ThreadsInsights' -Action $ins -Trigger $daily -Settings $settings -Description 'Threads 인사이트 기록 (D:\threads\인사이트기록.md)' -Force | Out-Null

Get-ScheduledTask -TaskName 'ThreadsAutoPost', 'ThreadsInsights' | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
