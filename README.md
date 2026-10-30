# OSPF Network Failover Monitoring Dashboard

A small local Flask web app to log and visualize measured results from your Cisco Packet Tracer OSPF failover experiment.

## Important accuracy note
This version is **not connected live to Packet Tracer routers**. The dashboard displays experiment results you enter manually after running the real Packet Tracer tests. Do not present its status cards as live router telemetry.

## Requirements
- Python 3.10+
- VS Code (or any text editor)
- Internet access for the Chart.js CDN used by the page

## Run on Windows
1. Extract the ZIP folder.
2. Open that folder in VS Code.
3. Open Terminal → New Terminal.
4. Run:
   ```powershell
   py -m venv .venv
   .\.venv\Scripts\activate
   pip install -r requirements.txt
   py app.py
   ```
   If `py` is not recognized, try `python` instead.
5. Open the local address printed in the terminal, normally `http://127.0.0.1:5000`.
6. Keep the terminal open while using the dashboard. Press `Ctrl+C` in the terminal to stop the server.

## How to record a test
- Run the ping test in Packet Tracer and note sent/received counts.
- For a normal test, choose scenario `Normal operation` and link status `All links up`.
- For a failure test, shut down Router2 G0/1, wait for OSPF to reconverge, then run the ping test. Choose `R2-R3 link failure` and `R2-R3 down`.
- For recovery, restore Router2 G0/1 using `no shutdown`, wait for reconvergence, and run another ping. Choose `Link restored` and `All links up`.
- Enter measured recovery time only if you actually measured it. Otherwise leave it as 0.
- Click **Save experiment**. The row is stored in `data/experiments.csv` and appears in the charts/table.

Packet loss is calculated automatically: `(sent - received) / sent × 100`.

## Router commands used in the project
### Disable direct R2-R3 link (Router2)
```text
enable
configure terminal
interface gigabitEthernet 0/1
shutdown
end
```

### Restore direct R2-R3 link (Router2)
```text
enable
configure terminal
interface gigabitEthernet 0/1
no shutdown
end
```

### Verify route (Router2)
```text
show ip route
show ip ospf neighbor
```

After the R2-R3 link is down, the expected route to `192.168.20.0/24` is via Router0 at `10.0.2.1` (based on the topology and addressing used in this project).

## Troubleshooting
- `No module named flask`: activate the virtual environment and run `pip install -r requirements.txt`.
- Port 5000 already in use: stop the other Flask app, or change the final line in `app.py` to `app.run(debug=True, port=5001)` and open port 5001.
- If the chart is blank, check internet access; the page loads Chart.js from a CDN.
