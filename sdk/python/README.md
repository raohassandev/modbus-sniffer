# Python client

```python
from modbus_workbench_client import WorkbenchClient

client = WorkbenchClient()
print(client.status())
print(client.read("meter-1", 1, 3, 0, 10))
```

Writes require explicit confirmation flags and still pass through the Workbench server's write-lock/audit service.
