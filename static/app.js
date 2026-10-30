let lossChart, recoveryChart;
let networkTimer;

function fmt(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value)}${suffix}`;
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

/* EXPERIMENT CHARTS */
function makeCharts(rows) {
  const lossCanvas = document.getElementById("lossChart");
  const recoveryCanvas = document.getElementById("recoveryChart");

  if (!lossCanvas || !recoveryCanvas || typeof Chart === "undefined") return;

  const labels = rows.map((r, i) => `${i + 1}. ${r.scenario}`);
  const loss = rows.map(r => Number(r.packet_loss_pct || 0));
  const recovery = rows.map(r => Number(r.recovery_seconds || 0));

  const common = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "#7b879b", maxRotation: 35, font: { size: 9 } }
      },
      y: {
        beginAtZero: true,
        grid: { color: "#edf1f6" },
        ticks: { color: "#7b879b", font: { size: 10 } }
      }
    }
  };

  if (lossChart) lossChart.destroy();
  if (recoveryChart) recoveryChart.destroy();

  lossChart = new Chart(lossCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: loss,
        borderColor: "#4569f5",
        backgroundColor: "rgba(69,105,245,.12)",
        fill: true,
        tension: 0.3,
        pointRadius: 4
      }]
    },
    options: {
      ...common,
      scales: {
        ...common.scales,
        y: {
          ...common.scales.y,
          max: 100,
          title: { display: true, text: "Packet loss (%)" }
        }
      }
    }
  });

  recoveryChart = new Chart(recoveryCanvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: recovery,
        backgroundColor: "#23b99b",
        borderRadius: 5,
        maxBarThickness: 34
      }]
    },
    options: {
      ...common,
      scales: {
        ...common.scales,
        y: {
          ...common.scales.y,
          title: { display: true, text: "Seconds" }
        }
      }
    }
  });
}

/* EXPERIMENT HISTORY */
function renderHistory(rows) {
  const body = document.getElementById("history-body");
  if (!body) return;

  if (!rows.length) {
    body.innerHTML =
      '<tr><td colspan="8">No experiments recorded yet. Add your first actual test below.</td></tr>';
    return;
  }

  body.innerHTML = rows.slice().reverse().map(r => `<tr>
    <td>${escapeHtml(r.timestamp)}</td>
    <td>${escapeHtml(r.scenario)}</td>
    <td>${escapeHtml(r.link_status)}</td>
    <td>${escapeHtml(r.sent)}</td>
    <td>${escapeHtml(r.received)}</td>
    <td>${Number(r.packet_loss_pct || 0).toFixed(2)}%</td>
    <td>${Number(r.recovery_seconds || 0).toFixed(1)} s</td>
    <td>${escapeHtml(r.notes)}</td>
  </tr>`).join("");
}

async function refresh() {
  const response = await fetch("/api/experiments", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load experiments");

  const rows = await response.json();

  const tests = document.getElementById("metric-tests");
  const loss = document.getElementById("metric-loss");
  const received = document.getElementById("metric-received");
  const recovery = document.getElementById("metric-recovery");

  if (tests) tests.textContent = rows.length;

  const latest = rows[rows.length - 1];

  if (loss) {
    loss.textContent = latest
      ? `${Number(latest.packet_loss_pct).toFixed(2)}%`
      : "—";
  }

  if (received) {
    received.textContent = latest
      ? `${latest.received} / ${latest.sent}`
      : "—";
  }

  if (recovery) {
    recovery.textContent = latest
      ? `${Number(latest.recovery_seconds).toFixed(1)} s`
      : "—";
  }

  renderHistory(rows);
  makeCharts(rows);
}

/* PACKET TRACER LIVE NETWORK */
function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function getNetworkData(apiData) {
  // The Packet Tracer bridge wraps getNetwork's result in nested objects.
  let value = apiData?.network ?? apiData;

  for (let i = 0; i < 5 && value; i++) {
    if (value.devices || value.connections) return value;

    if (value.result !== undefined) {
      value = value.result;
    } else {
      break;
    }
  }

  return value;
}

function renderDevices(devices) {
  const body = document.getElementById("network-devices-body");
  if (!body) {
    console.warn("Devices table body not found. Check index.html IDs.");
    return;
  }

  if (!Array.isArray(devices) || devices.length === 0) {
    body.innerHTML = '<tr><td colspan="4">No device data returned.</td></tr>';
    return;
  }

  body.innerHTML = devices.map(device => {
    const interfaces = Array.isArray(device.interfaces)
      ? device.interfaces
      : [];

    const upCount = interfaces.filter(
      item => item.isPortUp === true
    ).length;

    return `<tr>
      <td>${escapeHtml(device.name || "Unknown")}</td>
      <td>${escapeHtml(device.model || "—")}</td>
      <td>${escapeHtml(device.type ?? "—")}</td>
      <td>${upCount} / ${interfaces.length}</td>
    </tr>`;
  }).join("");
}

function renderConnections(connections) {
  const body = document.getElementById("network-links-body");
  if (!body) {
    console.warn("Connections table body not found. Check index.html IDs.");
    return;
  }

  if (!Array.isArray(connections) || connections.length === 0) {
    body.innerHTML = '<tr><td colspan="3">No connection data returned.</td></tr>';
    return;
  }

  body.innerHTML = connections.map(connection => `<tr>
    <td>${escapeHtml(connection.from || "—")} (${escapeHtml(connection.fromInterface || "—")})</td>
    <td>${escapeHtml(connection.to || "—")} (${escapeHtml(connection.toInterface || "—")})</td>
    <td>${connection.type === 8101 ? "Ethernet" : connection.type === 8100 ? "Ethernet" : escapeHtml(connection.type ?? "—")}</td>
  </tr>`).join("");
}

function renderInterfaces(devices) {
  const body = document.getElementById("network-interfaces-body");
  if (!body) {
    console.warn("Interface table body not found. Check index.html IDs.");
    return;
  }

  const rows = [];

  (Array.isArray(devices) ? devices : []).forEach(device => {
    const interfaces = Array.isArray(device.interfaces)
      ? device.interfaces
      : [];

    interfaces.forEach(item => {
      rows.push(`<tr>
        <td>${escapeHtml(device.name || "—")}</td>
        <td>${escapeHtml(item.name || "—")}</td>
        <td>${item.isPortUp ? "Up" : "Down"}</td>
        <td>${item.isProtocolUp ? "Up" : "Down"}</td>
        <td>${item.in_use ? "Yes" : "No"}</td>
      </tr>`);
    });
  });

  body.innerHTML = rows.length
    ? rows.join("")
    : '<tr><td colspan="5">No interface data returned.</td></tr>';
}

function showNetworkError(message) {
  setText("network-status-text", message);

  const dot = document.getElementById("network-status-dot");
  if (dot) dot.style.backgroundColor = "#c0392b";

  console.error("Packet Tracer:", message);
}

function displayNetwork(apiData) {
  const network = getNetworkData(apiData);

  if (!network || typeof network !== "object") {
    showNetworkError("The network response has an unexpected format.");
    console.error("Unexpected API data:", apiData);
    return;
  }

  const devices = Array.isArray(network.devices) ? network.devices : [];
  const connections = Array.isArray(network.connections)
    ? network.connections
    : [];

  setText("network-status-text", "Connected to Packet Tracer");
  setText("network-updated", `Updated: ${new Date().toLocaleTimeString()}`);
  setText("network-device-count", network.deviceCount ?? devices.length);
  setText("network-connection-count", network.connectionCount ?? connections.length);

  let up = 0;
  let down = 0;

  devices.forEach(device => {
    if (!Array.isArray(device.interfaces)) return;

    device.interfaces.forEach(item => {
      if (item.isPortUp) up++;
      else down++;
    });
  });

  setText("network-interfaces-up", up);
  setText("network-interfaces-down", down);

  const dot = document.getElementById("network-status-dot");
  if (dot) dot.style.backgroundColor = "#23b99b";

  renderDevices(devices);
  renderConnections(connections);
  renderInterfaces(devices);

  console.log("Packet Tracer network rendered:", {
    devices: devices.length,
    connections: connections.length
  });
}

async function refreshPacketTracer() {
  const button = document.getElementById("refresh-network");
  if (button) button.disabled = true;

  try {
    const response = await fetch("/api/network", { cache: "no-store" });
    const data = await response.json();

    if (!response.ok || data.success !== true) {
      throw new Error(data.error || `Network request failed (${response.status})`);
    }

    displayNetwork(data);
  } catch (error) {
    showNetworkError(`Could not load network: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

/* RECORD EXPERIMENT */
function initDashboard() {
  const form = document.getElementById("experiment-form");

  if (form) {
    form.addEventListener("submit", async event => {
      event.preventDefault();

      const values = Object.fromEntries(new FormData(form).entries());
      const message = document.getElementById("form-message");

      try {
        const response = await fetch("/api/experiments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values)
        });

        const result = await response.json();

        if (!response.ok) {
          if (message) {
            message.style.color = "#c0392b";
            message.textContent = result.error || "Could not save experiment.";
          }
          return;
        }

        if (message) {
          message.style.color = "#148568";
          message.textContent =
            `Saved. Calculated packet loss: ${Number(result.packet_loss_pct).toFixed(2)}%.`;
        }

        form.reset();
        if (form.elements.sent) form.elements.sent.value = 4;
        if (form.elements.received) form.elements.received.value = 4;
        if (form.elements.recovery_seconds) form.elements.recovery_seconds.value = 0;

        await refresh();
      } catch (error) {
        console.error("Experiment save failed:", error);
        if (message) {
          message.style.color = "#c0392b";
          message.textContent = "Could not save experiment. Check the Flask server.";
        }
      }
    });
  }

  refresh().catch(error => {
    console.error("Experiment refresh failed:", error);
    const body = document.getElementById("history-body");
    if (body) {
      body.innerHTML =
        '<tr><td colspan="8">Could not load records. Check that the Flask server is running.</td></tr>';
    }
  });

  refreshPacketTracer();

  if (networkTimer) clearInterval(networkTimer);
  networkTimer = setInterval(refreshPacketTracer, 5000);

  const refreshButton = document.getElementById("refresh-network");
  if (refreshButton) {
    refreshButton.addEventListener("click", refreshPacketTracer);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDashboard);
} else {
  initDashboard();
}