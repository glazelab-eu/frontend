#!/usr/bin/env python3
"""Builds the photo-suggestion model files (33-1): models/vision/model.onnx and models/vision/labels.json.

Run by hand when the model or models/vision/labels.source.json changes (labels.json is committed), or to make the model file
the build needs (model.onnx is not in git; scripts/vision-model-file.ts pins its size and SHA-256). These versions give the
pinned bytes:
    python3 -m venv /tmp/vision-venv && /tmp/vision-venv/bin/pip install numpy==2.5.4 onnx==1.23.2 onnxruntime==1.31.1 tokenizers==0.23.3
    /tmp/vision-venv/bin/python frontend/scripts/vision-model.py [--model tc40|tc8] [--work DIR]

It downloads a pinned TinyCLIP ONNX export (MIT) from Hugging Face, checks its SHA-256, keeps the IMAGE
tower only (the text tower never ships), quantizes its MatMul/Gemm weights to 8 bit, and embeds the label
prompts with the text tower into labels.json (unit vectors, one per label) together with the model's
preprocessing constants and logit scale. The thresholds in labels.json are calibrated per model by hand (docs/vision-check.md): a different model needs its own.
"""
import argparse, hashlib, json, os, sys, urllib.request

MODELS = {
    # The small option: 9 MB, top-3 accuracy about 92% on the 95-photo check (docs/vision-check.md); not shipped.
    'tc8': dict(repo='onnx-community/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M-ONNX', revision='9463a9c508a344c837ffefe9d724f3827bf2dc79',
                sha256='31d28cb07209533d10fc4fef73ac324ce17de6741a2372e7e1531a4ac8fdaeb2', id='tinyclip-vit-8m-16-yfcc15m',
                thresholds=dict(minProbability=0.15, minCosine=0.3, maxSuggestions=3),
                source='https://huggingface.co/wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M'),
    # SHIPPED (the user's decision of 2026-11-01): 45 MB, top-3 100%, top-1 83% on the same check. Same code, only the files change.
    'tc40': dict(repo='onnx-community/TinyCLIP-ViT-40M-32-Text-19M-LAION400M-ONNX', revision='737108a175dc6c043d9e64cf738baa91a272f7cb',
                 sha256='893cc6ae59654fb23d22747d3af35442bab5ed995a493834f65a58fc4af4cf84', id='tinyclip-vit-40m-32-laion400m',
                 thresholds=dict(minProbability=0.2, minCosine=0.2, maxSuggestions=3),
                 source='https://huggingface.co/wkcn/TinyCLIP-ViT-40M-32-Text-19M-LAION400M'),
}
TOKENIZER_SHA256 = '6d9109cc838977f3ca94a379eec36aecc7c807e1785cd729660ca2fc0171fb35'
MEAN = [0.48145466, 0.4578275, 0.40821073]
STD = [0.26862954, 0.26130258, 0.27577711]


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def fetch(repo, revision, name, target, expect):
    if not os.path.exists(target):
        url = f'https://huggingface.co/{repo}/resolve/{revision}/{name}'
        print('downloading', url)
        urllib.request.urlretrieve(url, target)
    if sha256(target) != expect:
        sys.exit(f'{target}: SHA-256 differs from the pinned {expect}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=sorted(MODELS), default='tc40')
    parser.add_argument('--out', help='output directory (default models/vision, which also holds labels.source.json)')
    parser.add_argument('--work', default=os.path.join(os.environ.get('TMPDIR', '/tmp'), 'vision-model-work'))
    args = parser.parse_args()
    spec = MODELS[args.model]
    here = os.path.dirname(os.path.abspath(__file__))
    source_dir = os.path.join(here, '..', 'models', 'vision')
    out = args.out or source_dir
    os.makedirs(out, exist_ok=True)
    os.makedirs(args.work, exist_ok=True)

    import numpy as np, onnx, onnx.utils, onnxruntime as ort
    from onnxruntime.quantization import quantize_dynamic, QuantType
    from tokenizers import Tokenizer

    combined = os.path.join(args.work, f'{args.model}-model.onnx')
    tokenizer_file = os.path.join(args.work, 'tokenizer.json')
    fetch(spec['repo'], spec['revision'], 'onnx/model.onnx', combined, spec['sha256'])
    fetch(spec['repo'], spec['revision'], 'tokenizer.json', tokenizer_file, TOKENIZER_SHA256)

    vision, text = (os.path.join(args.work, f'{args.model}-{part}.onnx') for part in ('vision', 'text'))
    onnx.utils.extract_model(combined, vision, ['pixel_values'], ['image_embeds'])
    onnx.utils.extract_model(combined, text, ['input_ids', 'attention_mask'], ['text_embeds'])
    quantized = os.path.join(out, 'model.onnx')
    quantize_dynamic(vision, quantized, weight_type=QuantType.QUInt8, op_types_to_quantize=['MatMul', 'Gemm'])

    # The logit scale of the pair (cosine similarity times scale = the model's logits).
    whole = ort.InferenceSession(combined, providers=['CPUExecutionProvider'])
    ids = np.full((1, 77), 49407, np.int64)
    ids[0, :4] = Tokenizer.from_file(tokenizer_file).encode('a photo of a mug').ids[:4]
    mask = np.zeros((1, 77), np.int64)
    mask[0, :4] = 1
    pixels = np.random.default_rng(1).standard_normal((1, 3, 224, 224)).astype(np.float32)
    result = dict(zip([o.name for o in whole.get_outputs()], whole.run(None, {'input_ids': ids, 'attention_mask': mask, 'pixel_values': pixels})))
    unit = lambda v: v / np.linalg.norm(v, axis=-1, keepdims=True)
    scale = float((result['logits_per_image'] / (unit(result['image_embeds']) @ unit(result['text_embeds']).T))[0, 0])

    source = json.load(open(os.path.join(source_dir, 'labels.source.json')))
    tokenizer = Tokenizer.from_file(tokenizer_file)
    session = ort.InferenceSession(text, providers=['CPUExecutionProvider'])
    labels = []
    for label in source['labels']:
        encoded = [tokenizer.encode(prompt).ids[:77] for prompt in label['prompts']]
        batch = np.full((len(encoded), 77), 49407, np.int64)
        attention = np.zeros((len(encoded), 77), np.int64)
        for row, tokens in enumerate(encoded):
            batch[row, :len(tokens)] = tokens
            attention[row, :len(tokens)] = 1
        embeds = unit(session.run(None, {'input_ids': batch, 'attention_mask': attention})[0])
        labels.append(dict(id=label['id'], tags=label.get('tags'), embedding=[round(float(x), 5) for x in unit(embeds.mean(axis=0))]))

    document = dict(model=dict(id=spec['id'], source=spec['source'], input=224, mean=MEAN, std=STD, scale=round(scale, 4), dimension=len(labels[0]['embedding'])),
                    thresholds=spec['thresholds'], labels=labels)
    with open(os.path.join(out, 'labels.json'), 'w') as f:
        json.dump(document, f, separators=(',', ':'), ensure_ascii=False)
        f.write('\n')
    print('model.onnx', os.path.getsize(quantized), sha256(quantized))
    print('labels.json', sha256(os.path.join(out, 'labels.json')), 'scale', scale)


if __name__ == '__main__':
    main()
