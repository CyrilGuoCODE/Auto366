window.electronAPI.onProgressUpdate(({ message, percent }) => {
  const fill = document.getElementById('fill');
  const status = document.getElementById('status');
  const pct = document.getElementById('pct');
  if (fill) fill.style.width = `${percent || 0}%`;
  if (status) status.textContent = message;
  if (pct) pct.textContent = `${percent || 0}%`;
});
