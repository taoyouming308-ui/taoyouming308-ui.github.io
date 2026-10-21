/* Optional, memory-only coalescing of explicitly selected reads. No response cache or write replay. */
(function () {
  'use strict';
  var channels = new Map();
  function invoke(send) { try { return Promise.resolve(send()); } catch (error) { return Promise.reject(error); } }
  window.ZysyrReadFlights = {
    request: function (channel, read, key, send) {
      var pending = channels.get(channel);
      if (!pending) { pending = new Map(); channels.set(channel, pending); }
      if (!read) {
        // A refresh during or after a mutation must never reuse a pre-mutation read.
        pending.clear();
        return invoke(send).finally(function () { pending.clear(); });
      }
      var existing = pending.get(key);
      // A stalled request must not indefinitely suppress an explicit retry.
      if (existing && Date.now() - existing.started < 5000) return existing.promise;
      var entry = { started: Date.now(), promise: null };
      entry.promise = invoke(send).finally(function () {
        if (pending.get(key) === entry) pending.delete(key);
      });
      pending.set(key, entry);
      return entry.promise;
    }
  };
})();
