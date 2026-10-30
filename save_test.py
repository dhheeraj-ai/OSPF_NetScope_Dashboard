import requests

url = "http://127.0.0.1:5000/api/experiments"

data = {
    "scenario": "OSPF Failover - Router2 to Router3 link down",
    "link_status": "Reachable via alternate route",
    "sent": 4,
    "received": 4,
    "recovery_seconds": 0,
    "notes": "Router2-Router3 link was disconnected. PC0 pinged PC3 successfully: 4 sent, 4 received, 0% loss."
}

response = requests.post(url, json=data, timeout=10)
print(response.status_code)
print(response.json())