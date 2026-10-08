export class LocalDocumentStore {
  constructor(storage) {
    this.storage = storage
  }

  readText(key, fallback = '') {
    try {
      return this.storage.getItem(key) ?? fallback
    } catch {
      return fallback
    }
  }

  readJson(key, fallback) {
    try {
      const value = this.storage.getItem(key)
      return value === null ? fallback : JSON.parse(value)
    } catch {
      return fallback
    }
  }

  writeText(key, value) {
    try {
      this.storage.setItem(key, String(value))
      return true
    } catch {
      return false
    }
  }

  writeJson(key, value) {
    try {
      this.storage.setItem(key, JSON.stringify(value))
      return true
    } catch {
      return false
    }
  }

  remove(key) {
    try {
      this.storage.removeItem(key)
      return true
    } catch {
      return false
    }
  }
}
