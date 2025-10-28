/**
 * Google Apps Script: 将订阅（只读）日历的事件同步到你的 "Merged Calendar"
 * 说明：需要在 Apps Script 中启用 Advanced Calendar API（Calendar）。
 *
 * 主要思路：
 * - 找出 accessRole 为 reader/freeBusyReader 的 calendarList 项（即订阅日历）
 * - 对每个 source event：根据 ScriptProperties 中的映射决定插入或更新目标事件
 * - 当源事件被取消时，删除目标副本
 *
 * 注意事项与限制见脚本底部文档注释
 */

const MERGED_CALENDAR_NAME = "All Subscribed"; // 目标日历名称，可改
const LOOKBACK_DAYS = 30;   // 向前同步多少天的历史事件
const LOOKAHEAD_DAYS = 365; // 向后同步多少天的未来事件
const PROP_PREFIX = "LCSYNC_"; // ScriptProperties key 前缀

/**
 * 主同步入口（手动执行或通过触发器）
 */
function syncSubscribedToMerged() {
  const mergedCal = ensureMergedCalendar();
  const mergedCalId = mergedCal.getId();

  const now = new Date();
  const timeMin = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 3600 * 1000).toISOString();

  // 获取日历列表（使用 Advanced API）
  let pageToken = null;
  do {
    const res = Calendar.CalendarList.list({ maxResults: 250, pageToken: pageToken });
    const items = res.items || [];
    for (let i = 0; i < items.length; i++) {
      const calItem = items[i];
      // 过滤条件：订阅/只读的日历（accessRole 为 reader 或 freeBusyReader）
      if (!calItem.id || calItem.id === mergedCalId) continue;
      if (calItem.accessRole === 'reader' || calItem.accessRole === 'freeBusyReader') {
        syncCalendarEvents(calItem.id, mergedCalId, timeMin, timeMax);
      }
    }
    pageToken = res.nextPageToken;
  } while (pageToken);
}

/**
 * 确保目标 merged 日历存在，返回 Calendar 对象
 */
function ensureMergedCalendar() {
  const name = MERGED_CALENDAR_NAME;
  const cals = CalendarApp.getCalendarsByName(name);
  if (cals && cals.length > 0) {
    return cals[0];
  }
  // 创建新的日历
  const newCal = CalendarApp.createCalendar(name);
  return newCal;
}

/**
 * 同步单个源日历在指定时间范围内的事件
 * - 会读取源事件（使用 Advanced API 以获取 updated、status 等）
 * - 通过 ScriptProperties 存储映射与上次更新时间
 */
function syncCalendarEvents(sourceCalId, targetCalId, timeMin, timeMax) {
  const props = PropertiesService.getScriptProperties();
  const pageSize = 2500;
  let pageToken = null;

  do {
    const opt = {
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true, // 展开重复实例，便于处理每个 occurrence
      maxResults: pageSize,
      showDeleted: false,
      pageToken: pageToken
    };

    const res = Calendar.Events.list(sourceCalId, opt);
    const events = res.items || [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      processSingleEvent(ev, sourceCalId, targetCalId, props);
    }
    pageToken = res.nextPageToken;
  } while (pageToken);
}

/**
 * 处理单个源事件：insert / update / delete
 */
function processSingleEvent(sourceEvent, sourceCalId, targetCalId, props) {
  // key 用于 ScriptProperties 存映射：sourceCalId|sourceEventId
  const key = PROP_PREFIX + sourceCalId + "|" + sourceEvent.id;
  const stored = props.getProperty(key); // 存 JSON: {"targetId":"...","sourceUpdated":"2023-..."}
  const sourceUpdated = sourceEvent.updated || sourceEvent.updated; // ISO string

  // 如果事件是被取消（例如 organizer cancel），删除对应副本
  if (sourceEvent.status === "cancelled") {
    if (stored) {
      try {
        const obj = JSON.parse(stored);
        if (obj.targetId) {
          // 删除目标事件（用 Advanced API）
          Calendar.Events.remove(targetCalId, obj.targetId);
        }
      } catch (e) { /* ignore parse errors */ }
      props.deleteProperty(key);
    }
    return;
  }

  // 如果已有映射且时间戳一致 -> 跳过
  if (stored) {
    try {
      const obj = JSON.parse(stored);
      if (obj.sourceUpdated === sourceUpdated) {
        // 未变化
        return;
      }
      // 否则需要更新目标事件
      if (obj.targetId) {
        // build event resource and patch
        const eventBody = buildEventBodyFromSource(sourceEvent, sourceCalId);
        try {
          Calendar.Events.patch(eventBody, targetCalId, obj.targetId);
          // 更新 stored info
          obj.sourceUpdated = sourceUpdated;
          props.setProperty(key, JSON.stringify(obj));
          return;
        } catch (e) {
          // 如果 patch 失败（比如 targetId 不存在），我们会尝试插入新事件并覆盖 mapping
          console.error("Patch failed, will try insert: " + e);
        }
      }
    } catch (e) { /* parse error -> fallthrough to insert */ }
  }

  // 无映射，或者需要重建：插入新事件
  const eventBody = buildEventBodyFromSource(sourceEvent, sourceCalId);
  // 在 description 里加上 origin 标记，便于人工排查（可选）
  if (!eventBody.description) eventBody.description = "";
  eventBody.description += "\n\n[SyncedFrom] " + sourceCalId + " | sourceEventId: " + sourceEvent.id;

  try {
    const inserted = Calendar.Events.insert(eventBody, targetCalId);
    const store = {
      targetId: inserted.id,
      sourceUpdated: sourceUpdated
    };
    props.setProperty(key, JSON.stringify(store));
  } catch (e) {
    console.error("Insert failed for source event " + sourceEvent.id + " : " + e);
  }
}

/**
 * 从源事件构建要写入目标日历的 event resource（Calendar API 事件对象）
 * 这里复制常见字段：summary, description, start, end, location, attendees, recurrence, reminders, transparency, visibility
 */
function buildEventBodyFromSource(ev, sourceCalId) {
  const body = {};

  if (ev.summary) body.summary = ev.summary;
  if (ev.description) body.description = ev.description;
  if (ev.location) body.location = ev.location;

  // start / end 支持 date 或 dateTime
  if (ev.start) body.start = copyDateOrDateTime(ev.start);
  if (ev.end) body.end = copyDateOrDateTime(ev.end);

  // attendees（只复制基础字段）
  if (ev.attendees) {
    body.attendees = ev.attendees.map(function(a) {
      return {
        email: a.email,
        displayName: a.displayName,
        responseStatus: a.responseStatus
      };
    });
  }

  // recurrence
  if (ev.recurrence) body.recurrence = ev.recurrence;

  // reminders (use same overrides if present)
  if (ev.reminders) body.reminders = ev.reminders;

  // transparency, visibility, status
  if (ev.transparency) body.transparency = ev.transparency;
  if (ev.visibility) body.visibility = ev.visibility;
  if (ev.status) body.status = ev.status;

  // keep source info in extendedProperties.private (optional)
  body.extendedProperties = {
    private: {
      sourceCalendarId: sourceCalId,
      sourceEventId: ev.id
    }
  };

  return body;
}

function copyDateOrDateTime(src) {
  // src can be {date:"YYYY-MM-DD"} or {dateTime:"..."}
  const out = {};
  if (src.date) out.date = src.date;
  if (src.dateTime) out.dateTime = src.dateTime;
  if (src.timeZone) out.timeZone = src.timeZone;
  return out;
}
