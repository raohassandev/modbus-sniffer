'use strict';
(()=>{
  try{pageMeta.help=['Help / How to Use','Operational guide for Sniffer, Master, Slave and advanced Modbus engineering tools.'];}catch{}
  const nav=document.querySelector('.nav'),main=document.querySelector('main');if(!nav||!main||document.getElementById('page-help'))return;
  const b=document.createElement('button');b.className='nav-item';b.dataset.page='help';b.innerHTML='<span>?</span> Help';nav.appendChild(b);
  main.insertAdjacentHTML('beforeend',`
  <section class="page" id="page-help"><div class="help7">
    <div class="help7-hero"><div><h2>How to Use This Modbus Engineering Tool</h2><p>Start with the mode that matches the job. Sniffer observes, Master polls, Slave simulates. Advanced tools support those three workflows.</p></div><div class="help7-badges"><span>MODBUS ONLY</span><span>WRITES LOCKED BY DEFAULT</span></div></div>

    <article class="help7-card"><h3>Start Here</h3><div class="help7-table"><table><thead><tr><th>Mode</th><th>What it does</th><th>Transmits?</th><th>First action</th></tr></thead><tbody>
      <tr><td><strong>Sniffer / Analyzer</strong></td><td>Passively learns devices, polling groups, values, timing and errors from existing Modbus traffic.</td><td>No</td><td>RTU: Settings → serial source. TCP: route the client through Modbus TCP Analyzer Proxy.</td></tr>
      <tr><td><strong>Master</strong></td><td>Actively polls a Modbus RTU/ASCII/TCP device and performs guarded writes/diagnostics.</td><td>Yes</td><td>Master → connection → Connect → Unit/FC/Address/Quantity → Read Once.</td></tr>
      <tr><td><strong>Slave</strong></td><td>Runs simulated Modbus devices with editable memory and optional LAB behavior.</td><td>Responses only</td><td>Slave → transport → configure Unit IDs/memory → Start Server.</td></tr>
    </tbody></table></div></article>

    <div class="help7-grid">
      <article class="help7-card"><h3>Sniffer workflow</h3><ol><li>For <strong>RTU</strong>, open Settings and select the physical serial port, baud, parity, data bits and stop bits.</li><li>For an existing <strong>Modbus TCP</strong> conversation, open Modbus TCP Analyzer, bind to this PC's Ethernet IP, set the real device as Target, then point the PLC/client at the analyzer IP. Direct PLC→device unicast traffic bypasses the inline analyzer.</li><li>Use <strong>Dashboard</strong> to verify the active source before trusting device data. Noisy/unmatched IDs remain diagnostic-only until a request↔response pair is matched.</li><li><strong>Devices</strong> shows confirmed RTU Slaves / TCP Unit IDs separately by channel.</li><li><strong>Live Traffic</strong> shows request/response/timeouts and exact raw frames with their transport/source.</li><li><strong>Analysis</strong> checks timing, matching, CRC/LRC/MBAP, duplicates, exceptions and jitter.</li><li><strong>Registers</strong> shows values learned from confirmed response context; <strong>Decoder/Data Lab</strong> interprets word combinations.</li></ol><p class="help7-note">Sniffer does not poll. If you need an independent active TCP read without changing the PLC route, use Master.</p></article>

      <article class="help7-card"><h3>Master workflow</h3><ol><li>Select RTU, ASCII or TCP and connect.</li><li>Enter Unit ID, FC01–04, zero-based start address and quantity.</li><li>Use <strong>Read Once</strong> first; then Start Polling.</li><li>Set retries/inter-request delay only when the device/network requires them. Serial RS-485 adapters can use RTS direction controls.</li><li>Use Monitor Sessions to save multiple polling definitions. They are persisted on the workstation and restored across normal browser/desktop restarts.</li><li>Use Quick Format or Data Lab for datatype/order/scaling; use Logger/Trend for history.</li><li>Writes use the guarded write panel and re-lock automatically after the operation.</li></ol><p class="help7-note">Automatic retry applies to reads/diagnostics, not guarded writes.</p></article>

      <article class="help7-card"><h3>Slave workflow</h3><ol><li>Select RTU/ASCII/TCP for normal use; advanced network transports are also available.</li><li>Add Unit IDs and size their Coils, Discrete Inputs, Holding Registers and Input Registers.</li><li>Edit memory directly, then Start Server.</li><li>Watch clients and protocol events to verify incoming requests.</li><li>Use Advanced LAB Behavior only for deliberate delay/exception/fault tests.</li><li>Dynamic generators can create counter, sawtooth, sine, random, timestamp, formula or schedule values with explicit LAB confirmation.</li></ol></article>

      <article class="help7-card"><h3>Addressing</h3><p>Wire requests use zero-based PDU addresses. The UI can also show familiar reference notation:</p><div class="help7-table compact"><table><thead><tr><th>FC</th><th>Area</th><th>First reference</th><th>PDU</th></tr></thead><tbody><tr><td>01</td><td>Coils</td><td>00001</td><td>0</td></tr><tr><td>02</td><td>Discrete Inputs</td><td>10001</td><td>0</td></tr><tr><td>04</td><td>Input Registers</td><td>30001</td><td>0</td></tr><tr><td>03</td><td>Holding Registers</td><td>40001</td><td>0</td></tr></tbody></table></div></article>
    </div>

    <article class="help7-card"><h3>Advanced tools</h3><div class="help7-tool-grid">
      <div><strong>Traffic</strong><p>Shared evidence from Sniffer, Master, Slave, Discovery, Test Sequences and Raw Lab. Filter, inspect, bookmark, annotate and export selected packets.</p></div>
      <div><strong>Protocol Diagnostics</strong><p>Validates RTU CRC, ASCII LRC, TCP MBAP, request/response matching, exceptions, duplicates, TID order, RTT and bus gaps.</p></div>
      <div><strong>Decoder / Data Lab</strong><p>Interpret words as integer/float, ASCII/UTF-8, BCD, timestamp, enum and bitfield values with byte/word order and engineering scaling.</p></div>
      <div><strong>Discovery</strong><p>Industrial network discovery accepts host/CIDR/range targets, inventories IP/MAC/vendor/hostname/services, verifies Modbus TCP before labeling it Modbus, supports optional Nmap and read-only SNMP/LLDP enrichment, saves baselines/history, and can hand a selected endpoint into Master. The Modbus Discovery tab retains FC43 Unit scans, address/range scans, function probes and safe quantity probes.</p></div>
      <div><strong>Device Clone</strong><p>Converts observed register evidence into a built-in Slave simulator map. Review before running it.</p></div>
      <div><strong>Test Sequences</strong><p>Bounded Modbus read/write/delay/set/assert/repeat recipes. Normal write safety still applies.</p></div>
      <div><strong>Transport Lab</strong><p>One-shot tests for TCP, TLS/Security, UDP and RTU/ASCII network tunnels with exact wire evidence. Non-standard encapsulations are labeled.</p></div>
      <div><strong>Raw Frame Lab</strong><p>Manual RTU/ASCII/TCP frames, CRC/LRC helpers, expected response masks, reusable cases and conformance suites. Risky/malformed frames require LAB arming.</p></div>
      <div><strong>Logger / Trend</strong><p>Log selected Sniffer/Master register values and communication events with bounded rotating storage, live trends and CSV export.</p></div>
      <div><strong>Replay / Compare</strong><p>Compare captures, register maps or Test Sequence runs without changing the live session.</p></div>
      <div><strong>Sessions</strong><p>Save/load .mbcap passive captures and replay original timing through the analyzer.</p></div>
    </div></article>

    <article class="help7-card"><h3>Function-code coverage</h3><div class="help7-table"><table><thead><tr><th>Function</th><th>Purpose</th><th>Where</th></tr></thead><tbody>
      <tr><td>FC01/02/03/04</td><td>Normal read/poll</td><td>Master, Discovery, Slave</td></tr>
      <tr><td>FC05/06/15/16</td><td>Coil/register writes</td><td>Guarded Master / Slave</td></tr>
      <tr><td>FC07/08/11/12/17</td><td>Serial diagnostics/status</td><td>Master Advanced / Slave</td></tr>
      <tr><td>FC20/21</td><td>File Record</td><td>Master Advanced / Slave</td></tr>
      <tr><td>FC22/23</td><td>Mask write / read-write multiple registers</td><td>Guarded Master / Slave</td></tr>
      <tr><td>FC24</td><td>FIFO queue</td><td>Master Advanced / Slave</td></tr>
      <tr><td>FC43/14</td><td>Device identification</td><td>Master, Discovery, Slave</td></tr>
    </tbody></table></div></article>

    <article class="help7-card"><h3>Connection ownership & safety</h3><ul><li>A physical serial port is never silently shared by Sniffer, Master, Slave, Raw Lab or active RTU Discovery.</li><li>When switching an occupied serial port, the UI asks before disconnecting/stopping the current owner.</li><li>Master writes are locked by default; guarded writes require explicit confirmation and automatically re-lock.</li><li>Raw/malformed frames and simulator fault injection are LAB functions and require explicit arming/confirmation.</li><li>Modbus TCP Security/TLS is presented separately from non-standard RTU/ASCII tunnel encapsulations.</li></ul></article>

    <article class="help7-card"><h3>Common troubleshooting</h3><div class="help7-tool-grid">
      <div><strong>No Sniffer traffic</strong><p>Verify the correct COM port, baud/parity/data/stop bits, RS-485 A/B polarity, common reference and that another Master is actually polling the bus.</p></div>
      <div><strong>Master timeouts</strong><p>Verify Unit ID, function/address range and serial format/IP/port. Open Traffic to see exact Tx/timeout evidence before increasing retries.</p></div>
      <div><strong>Values look wrong</strong><p>Confirm zero-based vs reference address first, then use Data Lab to test signedness, scale and byte/word order.</p></div>
      <div><strong>Slave does not answer</strong><p>Check server is Running, target Unit exists, requested address fits configured memory, and the client is using the same framing/transport.</p></div>
    </div></article>
  </div></section>`);
})();