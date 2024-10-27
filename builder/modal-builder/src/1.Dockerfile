# Stage 1: Base image with common dependencies
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04 as base

# Combine all ENV statements
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_PREFER_BINARY=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Install Python, git and other necessary tools
# Combine update, install, and cleanup in a single RUN to reduce layers
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3.10 \
    python3-pip \
    git \
    wget \
    python3-opencv \
    libopencv-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /comfyui

# Clone ComfyUI and install dependencies in one layer
RUN git clone https://github.com/comfyanonymous/ComfyUI.git . && \
    pip3 install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 && \
    pip3 install --no-cache-dir -r requirements.txt && \
    pip3 install --no-cache-dir runpod requests runpod requests opencv-python-headless dill ultralytics imageio-ffmpeg brotli pydantic aiofiles

# Create a directory for the source files
RUN mkdir -p /src

# Copy configuration and script files
COPY src/extra_model_paths.yaml ./
COPY src/start.sh src/rp_handler.py /src/
COPY test_input.json ./

# Make the start script executable
RUN chmod +x /src/start.sh

# Stage 2: Download models
FROM base as downloader

ARG HUGGINGFACE_ACCESS_TOKEN
ARG MODEL_TYPE

# Create necessary directories first
RUN mkdir -p models/{checkpoints,vae,unet,clip} custom_nodes

# Download models based on type
RUN case "$MODEL_TYPE" in \
    "sdxl") \
        wget -O models/checkpoints/sd_xl_base_1.0.safetensors https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors && \
        wget -O models/vae/sdxl_vae.safetensors https://huggingface.co/stabilityai/sdxl-vae/resolve/main/sdxl_vae.safetensors && \
        wget -O models/vae/sdxl-vae-fp16-fix.safetensors https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl_vae.safetensors \
        ;; \
    "sd3") \
        wget --header="Authorization: Bearer ${HUGGINGFACE_ACCESS_TOKEN}" \
             -O models/checkpoints/sd3_medium_incl_clips_t5xxlfp8.safetensors \
             https://huggingface.co/stabilityai/stable-diffusion-3-medium/resolve/main/sd3_medium_incl_clips_t5xxlfp8.safetensors \
        ;; \
    "flux1-schnell") \
        wget -O models/unet/flux1-schnell.safetensors https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/flux1-schnell.safetensors && \
        wget -O models/clip/clip_l.safetensors https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors && \
        wget -O models/clip/t5xxl_fp8_e4m3fn.safetensors https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors && \
        wget -O models/vae/ae.safetensors https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors \
        ;; \
    "flux1-dev") \
        wget --header="Authorization: Bearer ${HUGGINGFACE_ACCESS_TOKEN}" \
             -O models/unet/flux1-dev.safetensors \
             https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/flux1-dev.safetensors && \
        wget -O models/clip/clip_l.safetensors https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors && \
        wget -O models/clip/t5xxl_fp8_e4m3fn.safetensors https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors && \
        wget --header="Authorization: Bearer ${HUGGINGFACE_ACCESS_TOKEN}" \
             -O models/vae/ae.safetensors \
             https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/ae.safetensors \
        ;; \
    *) \
        echo "Unknown MODEL_TYPE: $MODEL_TYPE" && exit 1 \
        ;; \
    esac

# Clone custom nodes if needed
RUN if [ "$MODEL_TYPE" = "sdxl" ] || [ "$MODEL_TYPE" = "flux1-schnell" ] || [ "$MODEL_TYPE" = "flux1-dev" ]; then \
    git clone https://github.com/PowerHouseMan/ComfyUI-AdvancedLivePortrait.git custom_nodes/ComfyUI-AdvancedLivePortrait && \
    git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git custom_nodes/ComfyUI-VideoHelperSuite; \
    git clone https://github.com/BennyKok/comfyui-deploy.git custom_nodes/comfyui-deploy; \
    git clone https://github.com/ltdrdata/ComfyUI-Manager.git custom_nodes/ComfyUI-Manager; \
    fi

# Stage 3: Final image
FROM base as final

# Copy models and custom nodes from downloader stage
COPY --from=downloader /comfyui/models /comfyui/models
COPY --from=downloader /comfyui/custom_nodes /comfyui/custom_nodes
COPY --from=downloader /src /src

# Start the container
CMD ["/src/start.sh"]