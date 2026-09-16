# Modbus Engineering Workbench v8 SDK

The SDK clients call the same local v8 REST API used by the product UI. They do not bypass connection ownership, write locks, write confirmations, read-back policy or audit evidence.

- JavaScript: `require('./sdk/js')`
- Python: `sdk/python/modbus_workbench_client.py`

Remote API use is disabled by default in the supplied clients. Opt in only for a trusted endpoint and prefer TLS when leaving the local machine.
