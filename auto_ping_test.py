import platform
import subprocess
import requests
import time
from datetime import datetime

API_URL = "http://127.0.0.1:5000/api/experiments"

# Destination PC/server IP address
TARGET_IP = input("Enter destination IP address: ").strip()

# Initial packet-loss test
SENT = 4

# Recovery monitoring settings
PING_INTERVAL = 1
RECOVERY_TIMEOUT = 60


def ping_once(target_ip):
    """Send one ping and return True if the destination responds."""
    system = platform.system().lower()

    if system == "windows":
        command = ["ping", "-n", "1", "-w", "1000", target_ip]
    else:
        command = ["ping", "-c", "1", "-W", "1", target_ip]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=3
        )
        output = result.stdout.lower()

        # Use the process return code and output to determine reachability.
        if system == "windows":
            return (
                result.returncode == 0
                and "ttl=" in output
            )

        return result.returncode == 0

    except (subprocess.TimeoutExpired, OSError):
        return False


def run_ping(target_ip, count=4):
    """Run the initial ping test and return sent and received counts."""
    system = platform.system().lower()

    if system == "windows":
        command = ["ping", "-n", str(count), target_ip]
    else:
        command = ["ping", "-c", str(count), target_ip]

    print(f"\nRunning {count} ping requests to {target_ip}...")

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=30
    )

    output = result.stdout
    print("\n--- Ping Output ---")
    print(output)

    received = 0

    if system == "windows":
        for line in output.splitlines():
            if "Received =" in line:
                try:
                    received = int(
                        line.split("Received =")[1].split(",")[0].strip()
                    )
                except (ValueError, IndexError):
                    pass
                break
    else:
        for line in output.splitlines():
            if "packets transmitted" in line and "received" in line:
                try:
                    received = int(
                        line.split("received")[0].split(",")[-1].strip()
                    )
                except (ValueError, IndexError):
                    pass
                break

    return received


def measure_recovery(target_ip):
    """
    If the destination is unreachable, monitor it until it responds
    or the recovery timeout expires.

    Returns recovery duration in seconds.
    """
    print("\nDestination is unreachable.")
    print(f"Monitoring recovery for up to {RECOVERY_TIMEOUT} seconds...")

    start_time = time.monotonic()
    deadline = start_time + RECOVERY_TIMEOUT

    while time.monotonic() < deadline:
        if ping_once(target_ip):
            recovery_seconds = time.monotonic() - start_time

            print("Connection recovered!")
            print(f"Recovery time: {recovery_seconds:.2f} seconds")

            return round(recovery_seconds, 2), True

        time.sleep(PING_INTERVAL)

    print("Recovery was not detected within the monitoring period.")
    return round(time.monotonic() - start_time, 2), False


def save_result(sent, received, recovery_seconds, recovered):
    packet_loss = round((sent - received) * 100 / sent, 2)

    if received == 0 and recovered:
        link_status = "Recovered"
    elif received == 0:
        link_status = "Unreachable"
    elif received < sent:
        link_status = "Partial Packet Loss"
    else:
        link_status = "Reachable"

    payload = {
        "scenario": "Automated ping test",
        "link_status": link_status,
        "sent": sent,
        "received": received,
        "recovery_seconds": recovery_seconds,
        "notes": (
            f"Target IP: {TARGET_IP}; "
            f"packet loss: {packet_loss}%; "
            f"test time: "
            f"{datetime.now().astimezone().isoformat(timespec='seconds')}; "
            "Test executed from the host computer, not directly inside Packet Tracer."
        )
    }

    print("\n--- Test Summary ---")
    print(f"Packets sent: {sent}")
    print(f"Packets received: {received}")
    print(f"Packet loss: {packet_loss:.2f}%")
    print(f"Link status: {link_status}")
    print(f"Recovery time: {recovery_seconds:.2f} seconds")

    try:
        response = requests.post(
            API_URL,
            json=payload,
            timeout=10
        )
        response.raise_for_status()

        print("\nResult saved to NetScope dashboard!")
        print(response.json())

    except requests.RequestException as error:
        print("\nCould not save result to the website.")
        print("Make sure the Flask server is running.")
        print(f"Details: {error}")


if __name__ == "__main__":
    try:
        received = run_ping(TARGET_IP, SENT)

        recovery_seconds = 0.0
        recovered = False

        # Start recovery monitoring only if every initial ping failed.
        if received == 0:
            recovery_seconds, recovered = measure_recovery(TARGET_IP)

        save_result(
            SENT,
            received,
            recovery_seconds,
            recovered
        )

    except subprocess.TimeoutExpired:
        print("Initial ping command timed out.")
    except KeyboardInterrupt:
        print("\nTest cancelled.")