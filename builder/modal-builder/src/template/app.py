from config import config
import modal
from modal import Image, Mount, web_endpoint, Stub, asgi_app
import json
import urllib.request
import urllib.parse
from pydantic import BaseModel
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
import os

current_directory = os.path.dirname(os.path.realpath(__file__))
deploy_test = config["deploy_test"] == "True"
web_app = FastAPI()

# Platform configuration
PLATFORM = config.get("platform", "modal").lower()
GPU_CONFIG = {
    "modal": {
        "env_vars": {
            "DEBIAN_FRONTEND": "noninteractive",
            "PIP_PREFER_BINARY": "1",
            "PYTHONUNBUFFERED": "1"
        },
        "server_command": ["python", "main.py", "--disable-auto-launch", "--disable-metadata"],
        "host": "127.0.0.1",
        "port": "8188"
    },
    "runpod": {
        "env_vars": {
            "DEBIAN_FRONTEND": "noninteractive",
            "PIP_PREFER_BINARY": "1",
            "PYTHONUNBUFFERED": "1",
            "CUDA_VISIBLE_DEVICES": "0",
            "PYTHONPATH": "/comfyui"
        },
        "server_command": ["python", "main.py", "--listen", "--port", "8188", "--disable-auto-launch"],
        "host": "0.0.0.0",
        "port": "8188"
    }
}

print(f"Platform: {PLATFORM}")
print(f"Configuration: {config}")
print(f"Deploy test: {deploy_test}")

stub = Stub(name=config["name"])

def get_platform_config():
    return GPU_CONFIG.get(PLATFORM, GPU_CONFIG["modal"])

if not deploy_test:
    platform_config = get_platform_config()
    
    if PLATFORM == "modal":
        # For Modal, use the Python-based image building
        dockerfile_image = (
            modal.Image.debian_slim()
            .env(platform_config["env_vars"])
            .apt_install("git", "wget")
            .pip_install(
                "git+https://github.com/modal-labs/asgiproxy.git", "httpx", "tqdm"
            )
            .apt_install("libgl1-mesa-glx", "libglib2.0-0")
            # Install CUDA and PyTorch
            .run_commands(
                "apt-get update && apt-get install -y cuda-toolkit-12-1",
                "pip3 install --no-cache-dir torch==2.1.1 torchvision==0.16.1 torchaudio==2.1.1 --index-url https://download.pytorch.org/whl/cu121",
                "pip3 install --no-cache-dir xformers==0.0.23 --index-url https://download.pytorch.org/whl/cu121"
            )
            # ComfyUI setup
            .run_commands(
                "git clone https://github.com/comfyanonymous/ComfyUI.git /comfyui",
                "cd /comfyui && git reset --hard b12b48e170ccff156dc6ec11242bb6af7d8437fd",
                "cd /comfyui && pip install -r requirements.txt",
                # Install ComfyUI Manager
                "cd /comfyui/custom_nodes && git clone https://github.com/ltdrdata/ComfyUI-Manager.git",
                "cd /comfyui/custom_nodes/ComfyUI-Manager && pip install -r requirements.txt",
                "cd /comfyui/custom_nodes/ComfyUI-Manager && mkdir startup-scripts",
                # Install ComfyUI Deploy
                "cd /comfyui/custom_nodes && git clone https://github.com/BennyKok/comfyui-deploy.git",
                "cd /comfyui/custom_nodes/comfyui-deploy && git reset --hard 744a222e2652014e4d09af6b54fc11263b15e2f7"
            )
            .copy_local_file(f"{current_directory}/data/start.sh", "/start.sh")
            .run_commands("chmod +x /start.sh")
            .copy_local_file(f"{current_directory}/data/restore_snapshot.py", "/")
            .copy_local_file(f"{current_directory}/data/snapshot.json", "/comfyui/custom_nodes/ComfyUI-Manager/startup-scripts/restore-snapshot.json")
            .copy_local_file(f"{current_directory}/data/extra_model_paths.yaml", "/comfyui/")
            .run_commands("python restore_snapshot.py")
            .copy_local_file(f"{current_directory}/data/install_deps.py", "/")
            .copy_local_file(f"{current_directory}/data/models.json", "/")
            .copy_local_file(f"{current_directory}/data/deps.json", "/")
            .run_commands("python install_deps.py")
        )
    else:
        # For RunPod, use the existing Dockerfile
        dockerfile_image = Image.from_dockerfile(
            f"{current_directory}/Dockerfile",
            context_mount=Mount.from_local_dir(f"{current_directory}/data", remote_path="/data")
        )

# API Configuration
COMFY_API_AVAILABLE_INTERVAL_MS = 50
COMFY_API_AVAILABLE_MAX_RETRIES = 500
COMFY_POLLING_INTERVAL_MS = 250
COMFY_POLLING_MAX_RETRIES = 1000

def get_comfy_host():
    platform_config = get_platform_config()
    return f"{platform_config['host']}:{platform_config['port']}"

COMFY_HOST = get_comfy_host()

def check_server(url, retries=50, delay=500):
    import requests
    import time
    
    for i in range(retries):
        try:
            response = requests.get(url)
            if response.status_code == 200:
                print(f"{PLATFORM}-worker-comfy - API is reachable")
                return True
        except requests.RequestException:
            pass
            
        time.sleep(delay / 1000)

    print(f"{PLATFORM}-worker-comfy - Failed to connect to server at {url} after {retries} attempts.")
    return False

def check_status(prompt_id):
    req = urllib.request.Request(
        f"http://{COMFY_HOST}/comfyui-deploy/check-status?prompt_id={prompt_id}")
    return json.loads(urllib.request.urlopen(req).read())

class Input(BaseModel):
    prompt_id: str
    workflow_api: dict
    status_endpoint: str
    file_upload_endpoint: str

def queue_workflow_comfy_deploy(data: Input):
    data_str = data.json()
    data_bytes = data_str.encode('utf-8')
    req = urllib.request.Request(
        f"http://{COMFY_HOST}/comfyui-deploy/run", data=data_bytes)
    return json.loads(urllib.request.urlopen(req).read())

class RequestInput(BaseModel):
    input: Input

image = Image.debian_slim()
target_image = image if deploy_test else dockerfile_image

@stub.function(
    image=target_image,
    gpu=config["gpu"],
    secret=modal.Secret.from_dict({"PLATFORM": PLATFORM}) if not deploy_test else None
)
def run(input: Input):
    import subprocess
    import time
    
    platform_config = get_platform_config()
    
    print(f"{PLATFORM}-modal - check server")
    
    if PLATFORM == "runpod":
        # For RunPod, use the start.sh script as specified in the Dockerfile
        server_process = subprocess.Popen(
            ["/start.sh"],
            env={**os.environ, **platform_config["env_vars"]}
        )
    else:
        # For Modal, use the standard Python command
        server_process = subprocess.Popen(
            platform_config["server_command"],
            cwd="/comfyui",
            env={**os.environ, **platform_config["env_vars"]}
        )

    check_server(
        f"http://{COMFY_HOST}",
        COMFY_API_AVAILABLE_MAX_RETRIES,
        COMFY_API_AVAILABLE_INTERVAL_MS,
    )

    try:
        queued_workflow = queue_workflow_comfy_deploy(input)
        prompt_id = queued_workflow["prompt_id"]
        print(f"{PLATFORM}-modal - queued workflow with ID {prompt_id}")
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return {"error": f"Error queuing workflow: {str(e)}"}

    print(f"{PLATFORM}-modal - wait until image generation is complete")
    retries = 0
    status = ""
    
    try:
        while retries < COMFY_POLLING_MAX_RETRIES:
            status_result = check_status(prompt_id=prompt_id)
            if 'status' in status_result and (status_result['status'] == 'success' or status_result['status'] == 'failed'):
                status = status_result['status']
                print(status)
                break
            time.sleep(COMFY_POLLING_INTERVAL_MS / 1000)
            retries += 1
        else:
            return {"error": "Max retries reached while waiting for image generation"}
    except Exception as e:
        return {"error": f"Error waiting for image generation: {str(e)}"}

    print(f"{PLATFORM}-modal - Finished, turning off")
    server_process.terminate()

    return {"status": status}

@web_app.post("/run")
async def bar(request_input: RequestInput):
    if not deploy_test:
        run.spawn(request_input.input)
        return {"status": "success"}

@stub.function(image=image)
@asgi_app()
def comfyui_api():
    return web_app

def spawn_comfyui_in_background():
    import socket
    import subprocess
    
    platform_config = get_platform_config()
    host = platform_config["host"]
    port = platform_config["port"]
    
    if PLATFORM == "runpod":
        process = subprocess.Popen(
            ["/start.sh"],
            env={**os.environ, **platform_config["env_vars"]}
        )
    else:
        process = subprocess.Popen(
            [
                "python",
                "main.py",
                "--dont-print-server",
                "--port",
                port,
            ] + (["--listen"] if PLATFORM == "runpod" else []),
            cwd="/comfyui",
            env={**os.environ, **platform_config["env_vars"]}
        )

    while True:
        try:
            socket.create_connection((host, int(port)), timeout=1).close()
            print(f"ComfyUI webserver ready on {PLATFORM}!")
            break
        except (socket.timeout, ConnectionRefusedError):
            retcode = process.poll()
            if retcode is not None:
                raise RuntimeError(
                    f"comfyui main.py exited unexpectedly with code {retcode}"
                )

@stub.function(
    image=target_image,
    gpu=config["gpu"],
    allow_concurrent_inputs=100,
    concurrency_limit=1,
    timeout=10 * 60,
)
@asgi_app()
def comfyui_app():
    from asgiproxy.config import BaseURLProxyConfigMixin, ProxyConfig
    from asgiproxy.context import ProxyContext
    from asgiproxy.simple_proxy import make_simple_proxy_app

    platform_config = get_platform_config()
    host = platform_config["host"]
    port = platform_config["port"]

    spawn_comfyui_in_background()

    config = type(
        "Config",
        (BaseURLProxyConfigMixin, ProxyConfig),
        {
            "upstream_base_url": f"http://{host}:{port}",
            "rewrite_host_header": f"{host}:{port}",
        },
    )()

    return make_simple_proxy_app(ProxyContext(config))