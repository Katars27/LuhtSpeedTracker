// freezer.constants.js
window.LUHT = window.LUHT || {};
window.LUHT.freezer = window.LUHT.freezer || {};

(function(ns) {
  ns.CACHE_KEY = 'luht_freezer_tasklist_v1';
  ns.RETURN_URL_KEY = 'luht_freezer_return_url';
  ns.FINISHED_KEY = 'luht_finished_task_ids_v1';
  ns.MAX_CACHE_SIZE = 1000;

  ns.TASKLIST_REFRESH_TTL_MS = 5 * 60 * 1000;    // 5 минут
  ns.WORK_TIMEOUT_MS = 5000;                     // 5 секунд
  ns.REFRESH_FALLBACK_TIMEOUT = 30000;           // 30 секунд

  ns.TURBO_COOLDOWN_MS = 30 * 60 * 1000;         // 30 минут
  ns.TURBO_DEAD_TS_KEY = 'imageTurboProxyDeadTs';

  ns.HAS_ABORT = (typeof window.AbortController === 'function');

  ns.state = {
    taskList: [],
    picker: null,
    pickerList: null,
    pickerButton: null,
    isOpen: false,

    listBuilt: false,
    firstSwapDone: false,
    listReady: false,

    isRefreshing: false,
    lastTaskListFetchTS: 0,
    isWorking: false,
    workTimer: null,
    jumpLock: false,

    labelSection: null,
    labelBadge: null,
    lastBadgeText: '',
    lastBadgeVisible: false,

    turboRow: null,
    turboToggle: null,
    turboIcon: null,
    currentImg: null,

    resetPressTimer: null,
    didLongPress: false,
    LONG_PRESS_MS: 800,

    rTimer: null,
    longRTriggered: false,

    bgInterval: null
  };
})(window.LUHT.freezer);
