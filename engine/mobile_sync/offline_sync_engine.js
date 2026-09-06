/**
 * MOBILE BETA-1: Offline Queue & Idempotent Synchronization Engine
 * Staging offline operations, resolving conflicts, preventing duplicate ledger entries,
 * and maintaining cryptographic SHA-256 audit chaining.
 */

const crypto = require('crypto');

function sha256(data) {
  return crypto.createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
}

class OfflineSyncEngine {
  constructor() {
    this.offlineQueue = [];
    this.syncedLedger = [];
    this.processedIdempotencyKeys = new Set();
    this.genesisHash = "0000000000000000000000000000000000000000000000000000000000000000";
  }

  getLatestHash() {
    return this.syncedLedger.length === 0
      ? this.genesisHash
      : this.syncedLedger[this.syncedLedger.length - 1].hash;
  }

  /**
   * Enqueues an operation created locally while offline
   */
  enqueueOfflineMutation({
    actionType, // "CREATE_EXPENSE", "EDIT_EXPENSE", "DELETE_EXPENSE"
    payload,
    idempotencyKey = null
  }) {
    const key = idempotencyKey || `IDEM-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const queueItem = {
      queueId: `Q-${Date.now()}-${this.offlineQueue.length}`,
      idempotencyKey: key,
      actionType,
      payload,
      status: "PENDING_SYNC",
      queuedAt: new Date().toISOString()
    };

    this.offlineQueue.push(queueItem);
    return queueItem;
  }

  /**
   * Synchronizes offline queue with the authoritative backend
   */
  synchronize({ isNetworkOnline = true, simulateServerError = false } = {}) {
    if (!isNetworkOnline) {
      return {
        syncedCount: 0,
        remainingInQueue: this.offlineQueue.length,
        status: "OFFLINE_QUEUED"
      };
    }

    if (simulateServerError) {
      return {
        syncedCount: 0,
        remainingInQueue: this.offlineQueue.length,
        status: "SYNC_FAILED_RETRY_LATER"
      };
    }

    const syncedEntries = [];
    const remainingQueue = [];

    for (const item of this.offlineQueue) {
      // 1. Idempotency Check: Prevent duplicate ledger entries
      if (this.processedIdempotencyKeys.has(item.idempotencyKey)) {
        continue; // Drop duplicate retry without corrupting ledger
      }

      // 2. Build Cryptographic Ledger Block
      const prevHash = this.getLatestHash();
      const blockData = {
        index: this.syncedLedger.length,
        idempotencyKey: item.idempotencyKey,
        actionType: item.actionType,
        payload: item.payload,
        syncedAt: new Date().toISOString(),
        previousHash: prevHash
      };

      const blockHash = sha256(blockData);
      const ledgerBlock = {
        ...blockData,
        hash: blockHash
      };

      this.syncedLedger.push(ledgerBlock);
      this.processedIdempotencyKeys.add(item.idempotencyKey);
      syncedEntries.push(ledgerBlock);
    }

    this.offlineQueue = remainingQueue;

    return {
      syncedCount: syncedEntries.length,
      remainingInQueue: this.offlineQueue.length,
      status: "SYNC_SUCCESS",
      syncedEntries
    };
  }

  /**
   * Mathematically verifies integrity of the SHA-256 synchronized audit chain
   */
  verifyChainIntegrity() {
    for (let i = 0; i < this.syncedLedger.length; i++) {
      const current = this.syncedLedger[i];
      const prevHash = i === 0 ? this.genesisHash : this.syncedLedger[i - 1].hash;

      if (current.previousHash !== prevHash) {
        return { isValid: false, tamperedIndex: i, reason: "Hash link broken" };
      }

      const { hash, ...data } = current;
      const recomputedHash = sha256(data);
      if (recomputedHash !== hash) {
        return { isValid: false, tamperedIndex: i, reason: "Payload tampering detected" };
      }
    }

    return {
      isValid: true,
      blockCount: this.syncedLedger.length,
      latestHash: this.getLatestHash()
    };
  }
}

module.exports = { OfflineSyncEngine };
