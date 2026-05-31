// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();

  // ── Element refs ──
  const screenSplash    = document.getElementById('screen-splash');
  const screenSettings  = document.getElementById('screen-settings');
  const screenChat      = document.getElementById('screen-chat');

  const splashKeyInput  = document.getElementById('splash-key-input');
  const splashSaveBtn   = document.getElementById('splash-save-btn');
  const splashError     = document.getElementById('splash-error');

  const settingsBackBtn = document.getElementById('settings-back-btn');
  const settingsKeyInput= document.getElementById('settings-key-input');
  const settingsSaveBtn = document.getElementById('settings-save-btn');
  const settingsError   = document.getElementById('settings-error');
  const settingsClearBtn= document.getElementById('settings-clear-btn');
  const settingsBtn     = document.getElementById('settings-btn');

  const modelLabel      = document.getElementById('model-label');
  const modelOverride   = document.getElementById('model-override');
  const planStatusEl    = document.getElementById('plan-status');
  const budgetBar       = document.getElementById('budget-bar');
  const messagesEl      = document.getElementById('messages');

  const diffActions     = document.getElementById('diff-actions');
  const diffSummary     = document.getElementById('diff-summary');
  const feedbackActions = document.getElementById('feedback-actions');

  const btnAccept       = document.getElementById('btn-accept');
  const btnReject       = document.getElementById('btn-reject');
  const btnYes          = document.getElementById('btn-yes');
  const btnNo           = document.getElementById('btn-no');
  const btnSend         = document.getElementById('btn-send');
  const inputEl         = document.getElementById('input');

  // ── State ──
  let currentBubble   = null;
  let pendingTaskText = '';
  let pendingLogText  = '';
  let pendingLogModel = '';
  let streaming       = false;

  // ── Screen switching ──
  function show(screen) {
    screenSplash.classList.add('hidden');
    screenSettings.classList.add('hidden');
    screenChat.classList.add('hidden');
    screen.classList.remove('hidden');
  }

  // ── Splash ──
  splashSaveBtn.addEventListener('click', saveFromSplash);
  splashKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveFromSplash(); });

  function saveFromSplash() {
    clearError(splashError);
    const key = splashKeyInput.value.trim();
    if (!key) { showError(splashError, 'Key cannot be empty.'); return; }
    splashSaveBtn.disabled = true;
    splashSaveBtn.textContent = 'Checking…';
    vscode.postMessage({ type: 'saveApiKey', key });
  }

  // ── Settings ──
  settingsBtn.addEventListener('click', () => {
    settingsKeyInput.value = '';
    clearError(settingsError);
    show(screenSettings);
    settingsKeyInput.focus();
  });
  settingsBackBtn.addEventListener('click', () => show(screenChat));

  settingsSaveBtn.addEventListener('click', saveFromSettings);
  settingsKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveFromSettings(); });

  function saveFromSettings() {
    clearError(settingsError);
    const key = settingsKeyInput.value.trim();
    if (!key) { showError(settingsError, 'Key cannot be empty.'); return; }
    settingsSaveBtn.disabled = true;
    settingsSaveBtn.textContent = 'Checking…';
    vscode.postMessage({ type: 'saveApiKey', key });
  }

  settingsClearBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearApiKey' });
  });

  // ── Chat ──
  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'msg msg-' + role;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function send() {
    const text = inputEl.value.trim();
    if (!text || streaming) return;
    addMsg('user', text);
    inputEl.value = '';
    autoResize();
    vscode.postMessage({ type: 'sendMessage', text, model: modelOverride.value });
    btnSend.disabled = true;
    streaming = true;
    diffActions.classList.add('hidden');
    feedbackActions.classList.add('hidden');
  }

  btnSend.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', autoResize);

  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  }

  // ── Diff / Feedback ──
  btnAccept.addEventListener('click', () => {
    vscode.postMessage({ type: 'acceptDiff' });
    diffActions.classList.add('hidden');
  });
  btnReject.addEventListener('click', () => {
    vscode.postMessage({ type: 'rejectDiff' });
    diffActions.classList.add('hidden');
  });
  btnYes.addEventListener('click', () => {
    vscode.postMessage({ type: 'feedbackYes', taskText: pendingTaskText, logText: pendingLogText, model: pendingLogModel });
    feedbackActions.classList.add('hidden');
    addMsg('assistant', '✓ Marked as done in PLAN.md.');
  });
  btnNo.addEventListener('click', () => {
    vscode.postMessage({ type: 'feedbackNo', taskText: pendingTaskText });
    feedbackActions.classList.add('hidden');
    addMsg('assistant', '✗ Marked as failed in PLAN.md. Task re-queued.');
  });

  // ── Error helpers ──
  function showError(el, text) { el.textContent = text; el.classList.remove('hidden'); }
  function clearError(el) { el.textContent = ''; el.classList.add('hidden'); }

  function resetKeyButtons() {
    splashSaveBtn.disabled = false;
    splashSaveBtn.textContent = 'Save key';
    settingsSaveBtn.disabled = false;
    settingsSaveBtn.textContent = 'Update';
  }

  // ── Message handler ──
  window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.type) {
      case 'showSplash':
        resetKeyButtons();
        splashKeyInput.value = '';
        clearError(splashError);
        show(screenSplash);
        setTimeout(() => splashKeyInput.focus(), 50);
        break;

      case 'showChat':
        resetKeyButtons();
        show(screenChat);
        break;

      case 'keyValidating':
        break;

      case 'keyError':
        resetKeyButtons();
        // Show error on whichever screen is active
        if (!screenSettings.classList.contains('hidden')) {
          showError(settingsError, msg.text);
        } else {
          showError(splashError, msg.text);
        }
        break;

      case 'modelLabel':
        modelLabel.textContent = msg.model + ' · ' + msg.group;
        break;

      case 'planStatus':
        planStatusEl.textContent =
          msg.done + ' done · ' + msg.inProgress + ' in progress · ' +
          msg.pending + ' pending · ' + msg.failed + ' failed';
        planStatusEl.classList.remove('hidden');
        break;

      case 'budgetWarning':
        budgetBar.textContent = '⚠ ' + msg.group + ' at ' + msg.percent + '% — using ' + msg.model;
        budgetBar.classList.remove('hidden');
        break;

      case 'startStream':
        currentBubble = addMsg('assistant', '');
        break;

      case 'chunk':
        if (currentBubble) {
          currentBubble.textContent += msg.delta;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        break;

      case 'endStream':
        currentBubble = null;
        streaming = false;
        btnSend.disabled = false;
        break;

      case 'showDiffActions':
        diffSummary.textContent = msg.summary;
        diffActions.classList.remove('hidden');
        break;

      case 'diffAccepted':
        feedbackActions.classList.remove('hidden');
        break;

      case 'diffRejected':
        addMsg('assistant', 'Change discarded — no files modified.');
        btnSend.disabled = false;
        streaming = false;
        break;

      case 'pendingLog':
        pendingLogText  = msg.logText;
        pendingLogModel = msg.model;
        break;

      case 'pendingTask':
        pendingTaskText = msg.taskText;
        break;

      case 'error':
        addMsg('error', msg.text);
        btnSend.disabled = false;
        streaming = false;
        break;
    }
  });

  // Request initial state
  vscode.postMessage({ type: 'requestState' });
})();
