# JavaScript client

```js
const { WorkbenchApiClient } = require('./sdk/js');
const client = new WorkbenchApiClient();
const status = await client.status();
const read = await client.read({ connectionId: 'meter-1', unitId: 1, functionCode: 3, address: 0, quantity: 10 });
```

The client is loopback-only by default. Writes require explicit confirmation and use the same guarded product API as the UI.
