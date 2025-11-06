import requests
import datetime

start = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


THISISFINE_URL = "http://localhost:5000"

def get_all_tasks():
    try:
        res = requests.get(
            f"{THISISFINE_URL}/tasks?due_from=1970-01-01T00:00:00Z&due_to=2038-01-19T03:14:07Z",
            timeout=10
        )
        return res.json() if res.status_code == 200 else []
    except Exception as e:
        return []


def get_all_tasks_from_start():
    try:
        res = requests.get(
            f"{THISISFINE_URL}/tasks?due_from={start}&due_to=2038-01-19T03:14:07Z",
            timeout=10
        )
        return res.json() if res.status_code == 200 else []
    except Exception as e:
        return []