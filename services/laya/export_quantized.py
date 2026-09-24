import json
import os
import sys

import onnx
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from laya.agent import Agent

out_dir = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "/bundle")
os.makedirs(out_dir, exist_ok=True)

print("[export] loading official Laya multilingual checkpoint")
agent = Agent("convaiinnovations/laya", device="cpu", subfolder="multilingual")
model = agent.model.eval()
cfg = agent.cfg

try:
    model.encoder.config.reference_compile = False
except Exception:
    pass

class Wrapper(torch.nn.Module):
    def __init__(self, inner):
        super().__init__()
        self.inner = inner

    def forward(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
        logits, act = self.inner(input_ids, attention_mask, marker_pos, marker_mask, qtype)
        return logits, torch.softmax(act.float(), -1)

wrapper = Wrapper(model).eval()
B, L, K = 1, 40, 4
example = (
    torch.randint(5, 1000, (B, L), dtype=torch.long),
    torch.ones(B, L, dtype=torch.long),
    torch.tensor([[3, 9, 15, 21]], dtype=torch.long),
    torch.tensor([[True, True, True, True]], dtype=torch.bool),
    torch.tensor([0], dtype=torch.long),
)

fp32_path = os.path.join(out_dir, "laya-fp32.onnx")
batch = torch.export.Dim("batch")
seq = torch.export.Dim("seq", min=8)
opts = torch.export.Dim("options", min=2)

print("[export] exporting ONNX")
program = torch.onnx.export(
    wrapper,
    example,
    opset_version=18,
    dynamo=True,
    optimize=True,
    input_names=["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"],
    output_names=["logits", "act_probs"],
    dynamic_shapes={
        "input_ids": {0: batch, 1: seq},
        "attention_mask": {0: batch, 1: seq},
        "marker_pos": {0: batch, 1: opts},
        "marker_mask": {0: batch, 1: opts},
        "qtype": {0: batch},
    },
)
program.save(fp32_path, external_data=False)

# ORT's dynamic quantizer always runs ONNX shape inference first. The exported
# graph can contain stale intermediate/output dimensions from the dynamo
# exporter, which makes shape inference fail before quantization begins.
# Strip non-essential inferred shapes while preserving graph input types.
quant_source_path = os.path.join(out_dir, "laya-quant-source.onnx")
onnx_model = onnx.load(fp32_path, load_external_data=False)
del onnx_model.graph.value_info[:]
for output in onnx_model.graph.output:
    if output.type.HasField("tensor_type"):
        output.type.tensor_type.ClearField("shape")
onnx.save(onnx_model, quant_source_path)

int8_path = os.path.join(out_dir, "laya.onnx")
print("[export] quantizing ONNX weights to INT8")
quantize_dynamic(
    model_input=quant_source_path,
    model_output=int8_path,
    weight_type=QuantType.QInt8,
    per_channel=True,
    reduce_range=False,
    extra_options={"DisableShapeInference": True},
)

os.remove(fp32_path)
os.remove(quant_source_path)

tokenizer_dir = os.path.join(out_dir, "tokenizer")
agent.tok.save_pretrained(tokenizer_dir)

with open(os.path.join(out_dir, "laya_config.json"), "w", encoding="utf-8") as f:
    json.dump(
        {
            key: cfg[key]
            for key in ("max_len", "head_max_len", "temperature", "temperature_by_options")
        },
        f,
        ensure_ascii=False,
        indent=2,
    )

size_mb = os.path.getsize(int8_path) / 1_000_000
print(f"[export] INT8 bundle ready: {size_mb:.1f} MB")
