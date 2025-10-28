// ...existing code...
# sync_google_calendar

将所有已订阅的 Google 日历同步到一个新日历，便于第三方通过该单一日历进行订阅与同步。

## 使用说明（中文）

1. 在 Google Apps Script 创建新脚本： https://script.google.com/home  
2. 将脚本代码粘贴到编辑器。  
3. 在 Apps Script 中启用 Calendar API：Resources -> Advanced Google services -> 打开 Calendar API，然后在 Google Cloud Console 中为项目启用 Calendar API。  
4. 保存并运行脚本，完成授权。  
5. 设置定时触发器以定期运行脚本（例如每小时或每天）。

## 注意事项（中文）

- 脚本需要对源日历和目标日历的读写权限。  
- 在首次运行或更改权限时需进行授权。  
- 建议先在测试账号验证同步效果，再用于生产账号。  
- 如遇 API 权限或配额问题，请检查 Google Cloud Console 中的 API 配置与配额设置。

---

# sync_google_calendar

Sync all subscribed Google Calendars into a single new calendar so third parties can subscribe to and sync from that single calendar.

## Usage (English)

1. Create a new Google Apps Script: https://script.google.com/home  
2. Paste the script code into the editor.  
3. Enable the Calendar API in Apps Script: Resources -> Advanced Google services -> turn on Calendar API, then enable the Calendar API for the project in Google Cloud Console.  
4. Save and run the script to complete authorization.  
5. Create a time-driven trigger to run the script periodically (e.g., hourly or daily).

## Notes (English)

- The script requires read/write permission on source calendars and the destination calendar.  
- Authorization is required on first run or when permissions change.  
- Test with a non-production account before using in production.  
- If you encounter API permission or quota issues, check the Google Cloud Console API settings and quotas.
// ...existing code...