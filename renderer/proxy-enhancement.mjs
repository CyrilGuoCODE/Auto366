const DEFAULT_STORAGE_KEY = 'tun-autostart';

class ProxyEnhancement {
  constructor({ getProxyRunning, api, storage, storageKey = DEFAULT_STORAGE_KEY }) {
    this.getProxyRunning = getProxyRunning;
    this.api = api;
    this.storage = storage;
    this.storageKey = storageKey;
    this.pending = Promise.resolve();
    this.generation = 0;
  }

  isEnabled() {
    return this.storage.getItem(this.storageKey) === 'true';
  }

  async setEnabled(enabled) {
    const previous = this.isEnabled();
    const generation = ++this.generation;
    this.storage.setItem(this.storageKey, enabled ? 'true' : 'false');

    const result = enabled
      ? await this._enqueue(() => this._startIfNeeded(generation))
      : await this._stopImmediately();
    if (!result.success) {
      this.storage.setItem(this.storageKey, previous ? 'true' : 'false');
    }
    return { ...result, enabled: this.isEnabled() };
  }

  onProxyStarted() {
    const generation = this.generation;
    return this._enqueue(() => this._startIfNeeded(generation));
  }

  onProxyStopping() {
    this.generation += 1;
    return this._stopImmediately();
  }

  _enqueue(operation) {
    const run = this.pending.then(operation, operation);
    this.pending = run.catch(() => {});
    return run;
  }

  async _startIfNeeded(generation) {
    if (!this.isEnabled()) {
      return { success: true, running: false, skipped: true };
    }
    if (!this.getProxyRunning()) {
      return {
        success: true,
        running: false,
        deferred: true,
        message: 'TUN 代理增强已启用，将在代理启动时生效'
      };
    }

    try {
      const status = await this.api.getTunStatus();
      if (generation !== this.generation || !this.getProxyRunning()) {
        return {
          success: true,
          running: false,
          deferred: true,
          cancelled: true,
          message: 'TUN 代理增强已启用，将在下次代理启动时生效'
        };
      }
      if (status.running) {
        return { success: true, running: true, alreadyRunning: true };
      }
      const result = await this.api.startTun();
      if (result.cancelled) {
        return {
          ...result,
          success: true,
          running: false,
          deferred: true,
          message: 'TUN 代理增强已启用，将在下次代理启动时生效'
        };
      }
      return { ...result, running: !!result.success };
    } catch (error) {
      return { success: false, running: false, message: error.message };
    }
  }

  async _stopImmediately() {
    try {
      const result = await this.api.stopTun();
      return { ...result, running: result.success ? false : true };
    } catch (error) {
      return { success: false, running: true, message: error.message };
    }
  }
}

export { DEFAULT_STORAGE_KEY };
export default ProxyEnhancement;
