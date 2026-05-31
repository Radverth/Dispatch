// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();

  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('input');
  const btnSend = document.getElementById('btn-send');
  const modelLabel = document.getElementById('model-label');
  const modelOverride = document.getElementById('model-override');
  const planStatusEl = document.getElementById('plan-status');
  const diffActions = document.getElementById('diff-actions');
  const diffSummary = document.getElementById('diff-summary');
  const feedbackActions = document.getElementById('feedback-actions');
  const updateBar = document.getElementById('update-bar');
  const budgetBar = document.getElementById('budget-bar');
  const btnAccept = document.getElementById('btn-accept');
  const btnReject = document.getElementById('btn-reject');
  const btnYes = document.getElementById('btn-yes');
  const btnNo = document.getElementById('btn-no');
  const btnUpdate = document.getElementById('btn-update');
  const btnDismissUpdate = document.getElementById('btn-dismiss-update');

  let currentBubble = null;
  let pendingTaskText = '';
  let pendingLogText = '';
  let pendingLogModel = '';

  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    addMsg('user', text);
    inputEl.value = '';
    inputEl.style.height = 'auto';
    vscode.postMessage({ type: 'sendMessage', text, model: modelOverride.value });
    btnSend.disabled = true;
  }

  btnSend.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  btnAccept.addEventListener('click', () => {
    vscode.postMessage({ type: 'acceptDiff' });
    diffActions.classList.add('hidden');
  });
  btnReject.addEventListener('click', () => {
    vscode.postMessage({ type: 'rejectDiff' });
    diffActions.classList.add('hidden');
    feedbackActions.classList.add('hidden');
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
  btnUpdate.addEventListener('click', () => {
    vscode.postMessage({ type: 'triggerUpdate' });
    updateBar.classList.add('hidden');
  });
  btnDismissUpdate.addEventListener('click', () => updateBar.classList.add('hidden'));

  window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.type) {
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
        btnSend.disabled = false;
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
      case 'showDiffActions':
        diffSummary.textContent = msg.summary;
        diffActions.classList.remove('hidden');
        break;
      case 'diffAccepted':
        feedbackActions.classList.remove('hidden');
        diffActions.classList.add('hidden');
        break;
      case 'diffRejected':
        diffActions.classList.add('hidden');
        addMsg('assistant', 'Change discarded — no files modified.');
        btnSend.disabled = false;
        break;
      case 'pendingLog':
        pendingLogText = msg.logText;
        pendingLogModel = msg.model;
        break;
      case 'pendingTask':
        pendingTaskText = msg.taskText;
        break;
      case 'budgetWarning':
        budgetBar.textContent = '⚠ ' + msg.group + ' group at ' + msg.percent + '% today. This call uses ' + msg.model + '.';
        budgetBar.classList.remove('hidden');
        break;
      case 'showUpdateBar':
        updateBar.classList.remove('hidden');
        break;
      case 'error':
        addMsg('error', msg.text);
        btnSend.disabled = false;
        break;
    }
  });
})();
