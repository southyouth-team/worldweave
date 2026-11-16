import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ImageGenerationService } from './image-generation.service';

describe('ImageGenerationService procedural generation', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createService(values: Record<string, string>) {
    return new ImageGenerationService({
      get: (key: string) => values[key],
    } as never);
  }

  it('returns a procedural Three.js factory source without evaluating it', async () => {
    const service = createService({
      VISION_API_KEY: 'test-key',
      VISION_API_BASE_URL: 'http://vision.local/v1',
      VISION_MODEL: 'vision-test',
    });
    const source = 'export function createModel(THREE) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: source } }] }),
    });
    global.fetch = fetchMock as never;

    const result = await service.generateProceduralObjectFromPrompt('一栋教学楼', '教学楼', 'realistic');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://vision.local/v1/chat/completions');
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.messages[0].content).toContain('img2threejs editable procedural-draft');
    expect(request.messages[0].content).toContain('export function createModel(THREE)');
    expect(request.messages[0].content).toContain('Physical execution contract v1');
    expect(request.messages[0].content).toContain('userData.collisionPolicy');
    expect(request.messages[0].content).toContain('required');
    expect(request.messages[0].content).toContain('collisionPolicy to either');
    expect(request.messages[0].content).toContain('incomplete model');
    expect(request.messages[0].content).toContain('a visible Mesh is NOT automatically a collider');
    expect(request.messages[0].content).toContain('userData.textSpec');
    expect(request.messages[0].content).toContain('CJK-capable font');
    expect(request.messages[0].content).toContain('host-text-plate');
    expect(request.messages[0].content).toContain('shape:"mesh" blockers compile as static Rapier triangle meshes');
    expect(request.messages[0].content).toContain('shape:"box" blockers as oriented Rapier cuboids');
    expect(request.messages[0].content).toContain('must keep its own solid collider enabled in both open and closed states');
    expect(request.messages[0].content).toContain('The leaf collider remains active and follows the same part transform in either state');
    expect(request.messages[0].content).toContain('exact authored geometry, including real holes/openings, is preserved');
    expect(request.messages[0].content).toContain('userData.collisionMode = "none"');
    expect(request.messages[0].content).toContain('perimeter-only collision geometry');
    expect(request.messages[0].content).toContain('automatic water-boundary extraction is not implemented');
    expect(request.messages[0].content).toContain('stairs and ramps');
    expect(request.messages[0].content).toContain('isolated Rapier character-route test passes');
    expect(request.messages[0].content).toContain('Passages and spatial connections remain descriptive only');
    expect(request.messages[0].content).toContain('continuous closed boundary');
    expect(request.messages[0].content).toContain('For water bodies,');
    expect(request.messages[0].content).toContain('static Rapier triangle meshes');
    expect(request.messages[0].content).toContain('Do not use dynamic/deforming geometry as a static mesh collider');
    expect(request.messages[0].content).toContain('export function createModelAnimation(THREE, model, context)');
    expect(request.messages[0].content).toContain('update(frame)');
    expect(request.messages[0].content).toContain('frame.environment');
    expect(request.messages[0].content).toContain('environment.wind.speed');
    expect(request.messages[0].content).toContain('frame.worldState');
    expect(request.messages[0].content).toContain('capabilities.visual.animations');
    expect(request.messages[0].content).toContain('requestAnimationFrame');
    expect(request.messages[0].content).toContain('ShaderMaterial');
    expect(request.messages[0].content).toContain('onBeforeCompile');
    expect(request.messages[0].content).toContain('skybox');
    expect(request.messages[0].content).toContain('scene.background');
    expect(request.messages[0].content).toContain('AmbientLight');
    expect(request.messages[0].content).toContain('HemisphereLight');
    expect(request.messages[0].content).toContain('DirectionalLight');
    expect(request.messages[0].content).toContain('PointLight or SpotLight');
    expect(request.messages[0].content).toContain('leave it out rather than duplicating it');
    expect(request.messages[0].content).toContain('rain/snow/precipitation');
    expect(request.messages[0].content).toContain('Choose the environment response mechanism');
    expect(request.messages[0].content).toContain('continuous or dynamic response');
    expect(request.messages[0].content).not.toContain('visual.waterSurfaces');
    expect(request.messages[0].content).not.toContain('geometry.rotateX(-Math.PI / 2)');
    expect(result).toMatchObject({
      model: 'vision-test',
      objectType: '教学楼',
      generationMethod: 'img2threejs-procedural',
      generatedCode: source,
    });
  });

  it('retries with explicit feedback when the model returns HTML instead of JavaScript', async () => {
    const service = createService({
      VISION_API_KEY: 'test-key',
      VISION_API_BASE_URL: 'http://vision.local/v1',
      VISION_MODEL: 'vision-test',
    });
    const invalid = '<!doctype html><html><body>gateway error</body></html>';
    const valid = 'export function createModel(THREE) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: invalid } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: valid } }] }) });
    global.fetch = fetchMock as never;

    const result = await service.generateProceduralObjectFromPrompt('一栋教学楼', '教学楼', 'realistic');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.generatedCode).toBe(valid);
    const retryRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    const feedback = retryRequest.messages[retryRequest.messages.length - 1];
    expect(JSON.stringify(feedback.content)).toContain('源码不合法');
    expect(JSON.stringify(feedback.content)).toContain('不要 import 语句');
  });

  it('fails closed when generated sources keep importing external modules', async () => {
    const service = createService({
      VISION_API_KEY: 'test-key',
      VISION_API_BASE_URL: 'http://vision.local/v1',
      VISION_MODEL: 'vision-test',
    });
    const withImport = [
      "import * as Extra from 'three';",
      'export function createModel(THREE) { const group = new THREE.Group(); return group; }',
    ].join('\n');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: withImport } }] }),
    });
    global.fetch = fetchMock as never;

    await expect(service.generateProceduralObjectFromPrompt('一个测试模型', '模型', 'stylized'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  const validDraftSpec = {
    subject: '两层小教学楼',
    kind: 'building',
    dimensions: { width: 20, height: 8, depth: 12 },
    footprint: { type: 'rect', width: 20, depth: 12 },
    levels: 2,
    parts: [
      { id: 'body', role: 'main mass' },
      { id: 'roof', role: 'flat roof' },
      { id: 'windows', role: 'window bands' },
    ],
    materials: [{ name: 'wall', color: '#e8e4da' }],
    features: ['平屋顶', '横向窗带', '入口台阶'],
  };

  it('plans a validated structure spec before generating code', async () => {
    const service = createService({
      VISION_API_KEY: 'test-key',
      VISION_API_BASE_URL: 'http://vision.local/v1',
      VISION_MODEL: 'vision-test',
    });
    const source = 'export function createModel(THREE) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(validDraftSpec) } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: source } }] }),
      });
    global.fetch = fetchMock as never;
    const progress: any[] = [];

    const result = await service.generateProceduralObjectFromPrompt(
      '一栋两层小教学楼', '教学楼', 'realistic', undefined,
      event => progress.push(event),
      { specFirst: true },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const specRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(specRequest.response_format).toEqual({ type: 'json_object' });
    const codeRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    const specMessage = codeRequest.messages.find((message: any) => typeof message.content === 'string'
      && message.content.includes('Validated structure spec'));
    expect(specMessage).toBeTruthy();
    expect(specMessage.content).toContain('"subject":"两层小教学楼"');
    expect(result.generatedCode).toBe(source);
    expect(result.draftSpec.subject).toBe('两层小教学楼');
    expect(progress.some(event => event.stage === 'plan' && event.status === 'done')).toBe(true);
  });

  it('fails closed when the structure plan stays invalid', async () => {
    const service = createService({
      VISION_API_KEY: 'test-key',
      VISION_API_BASE_URL: 'http://vision.local/v1',
      VISION_MODEL: 'vision-test',
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }),
    });
    global.fetch = fetchMock as never;

    await expect(service.generateProceduralObjectFromPrompt(
      '一个物体', '物体', 'stylized', undefined, undefined, { specFirst: true },
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks for a massing-only blockout when stage=blockout', async () => {
    const service = createService({
      VISION_API_KEY: 'test-key',
      VISION_API_BASE_URL: 'http://vision.local/v1',
      VISION_MODEL: 'vision-test',
    });
    const source = 'export function createModel(THREE) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: source } }] }),
    });
    global.fetch = fetchMock as never;

    await service.generateProceduralObjectFromPrompt('一栋教学楼', '教学楼', 'realistic', undefined, undefined, { stage: 'blockout' });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.messages[0].content).toContain('Blockout stage');
    expect(request.messages[0].content).toContain('massing volumes');
    expect(request.messages[0].content).toContain('no zero-thickness planes');
  });

  it('normalizes typed text content from OpenAI-compatible vision gateways', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const source = 'export function createModel(THREE) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ finish_reason: 'stop', message: {
        content: [{ type: 'text', text: source }],
      } }] }),
    });
    global.fetch = fetchMock as never;

    const result = await service.generateProceduralObjectFromPrompt('一个测试模型', '模型', 'stylized');

    expect(result.generatedCode).toBe(source);
  });

  it('reports response-shape diagnostics when the vision gateway returns no source text', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_MODEL: 'vision-test' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ finish_reason: 'length', message: {
        content: null,
        reasoning_content: 'analysis only',
      } }] }),
    }) as never;

    await expect(service.generateProceduralObjectFromPrompt('一个测试模型', '模型', 'stylized'))
      .rejects.toThrow('contentType=null，finish_reason=length');
  });

  it('passes an edit reference image to the multimodal model', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const imageDataUrl = 'data:image/png;base64,aGVsbG8=';
    const generatedCode = 'export function createModel(THREE, params = {}) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ generatedCode, parameters: [], parts: [], changeSummary: '已按参考图调整' }) } }] }),
    });
    global.fetch = fetchMock as never;

    const result = await service.modifyProceduralObjectFromInstruction(
      'export function createModel(THREE) { return new THREE.Group(); }',
      [], {}, [], '', '参照图片把墙面改成这个颜色', '教学楼', [], {}, null, imageDataUrl,
    );

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    const content = request.messages[1].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content.find((part: any) => part.type === 'image_url').image_url.url).toBe(imageDataUrl);
    expect(request.messages[0].content).toContain('A reference image accompanies this edit request');
    expect(result.changeSummary).toBe('已按参考图调整');
  });

  it('passes the reference image to the multimodal model', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_MODEL: 'vision-test' });
    const imageDataUrl = 'data:image/png;base64,aGVsbG8=';
    const source = 'export function createModel(THREE) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: source } }] }),
    });
    global.fetch = fetchMock as never;

    await service.generateProceduralObjectFromPrompt('', '物体', 'stylized', imageDataUrl);

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.messages[1].content[1].image_url.url).toBe(imageDataUrl);
  });

  it('rejects invalid input and malformed factory output', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_MODEL: 'vision-test' });
    await expect(service.generateProceduralObjectFromPrompt(' ', '物体', 'stylized'))
      .rejects.toBeInstanceOf(BadRequestException);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'const group = {}; return group;' } }] }),
    }) as never;

    await expect(service.generateProceduralObjectFromPrompt('一个物体', '物体', 'stylized'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns a parameterized model update from conversational edit context', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const source = 'export const modelParameters = []; export const modelParts = []; export function createModel(THREE, params = {}) { const group = new THREE.Group(); return group; }';
    const generatedCode = 'export const modelParameters = [{ id: "roofColor", label: "屋顶颜色", type: "color", default: "#223355" }]; export const modelParts = [{ id: "roof", name: "屋顶" }]; export function createModel(THREE, params = {}) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        generatedCode,
        parameters: [{ id: 'roofColor', label: '屋顶颜色', type: 'color', default: '#223355' }],
        parts: [{ id: 'roof', name: '屋顶' }],
        changeSummary: '新增屋顶颜色控制',
      }) } }] }),
    });
    global.fetch = fetchMock as never;

    const result = await service.modifyProceduralObjectFromInstruction(
      source,
      [],
      { oldColor: '#ffffff' },
      [{ id: 'roof', name: '屋顶' }],
      'roof',
      '新增一个屋顶颜色控制参数',
      '教学楼',
    );

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.response_format).toEqual({ type: 'json_object' });
    const context = JSON.parse(request.messages[1].content);
    expect(context.currentParameterValues.oldColor).toBe('#ffffff');
    expect(context.selectedPartId).toBe('roof');
    expect(result).toMatchObject({
      generatedCode,
      parameters: [{ id: 'roofColor', type: 'color' }],
      parts: [{ id: 'roof', name: '屋顶' }],
      changeSummary: '新增屋顶颜色控制',
    });
  });

  it('retries once when an edit response is not valid JSON', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const generatedCode = 'export function createModel(THREE, params = {}) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'plain text without json' } }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ generatedCode, parameters: [], parts: [], changeSummary: '重试成功' }) } }] }),
      });
    global.fetch = fetchMock as never;

    const result = await service.modifyProceduralObjectFromInstruction(
      'export function createModel(THREE) { return new THREE.Group(); }',
      [], {}, [], '', '修改颜色', '教学楼',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retryRequest.messages[retryRequest.messages.length - 1].content).toContain('不是有效 JSON');
    expect(result.changeSummary).toBe('重试成功');
  });

  it('passes bounded geometry diagnostics into conversational model-edit context', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const generatedCode = 'export function createModel(THREE, params = {}) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        generatedCode, parameters: [], parts: [], changeSummary: '模型已更新',
      }) } }] }),
    });
    global.fetch = fetchMock as never;
    const geometryDiagnostics = {
      version: 1,
      summary: { meshCount: 1, vertexCount: 8, diagnosticCount: 1 },
      meshes: [{ componentId: 'part-a', vertexCount: 8, localBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } }],
      diagnostics: [{ code: 'non-finite-vertex', severity: 'error', componentId: 'part-a' }],
    };

    await service.modifyProceduralObjectFromInstruction(
      'export function createModel(THREE) { return new THREE.Group(); }',
      [], {}, [], '', '修复模型', '独立 3D 模型', [], {}, geometryDiagnostics,
    );

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    const context = JSON.parse(request.messages[1].content);
    expect(context.currentGeometryDiagnostics).toMatchObject({ ...geometryDiagnostics, truncated: false });
    expect(request.messages[0].content).toContain('Bounds overlap is only a spatial clue');
    expect(request.messages[0].content).toContain('HARD PART SCOPE');
    expect(request.messages[0].content).toContain('export function createModelAnimation(THREE, model, context)');
    expect(request.messages[0].content).toContain('update(frame)');
    expect(request.messages[0].content).toContain('frame.environment');
    expect(request.messages[0].content).toContain('environment.wind.speed');
    expect(request.messages[0].content).toContain('frame.worldState');
    expect(request.messages[0].content).toContain('capabilities.visual.animations');
    expect(request.messages[0].content).toContain('requestAnimationFrame');
    expect(request.messages[0].content).toContain('ShaderMaterial');
    expect(request.messages[0].content).toContain('onBeforeCompile');
    expect(request.messages[0].content).toContain('skybox');
    expect(request.messages[0].content).toContain('scene.background');
    expect(request.messages[0].content).toContain('AmbientLight');
    expect(request.messages[0].content).toContain('HemisphereLight');
    expect(request.messages[0].content).toContain('DirectionalLight');
    expect(request.messages[0].content).toContain('PointLight or SpotLight');
    expect(request.messages[0].content).toContain('leave it out rather than duplicating it');
    expect(request.messages[0].content).toContain('rain/snow/precipitation');
    expect(request.messages[0].content).toContain('Choose the environment response mechanism');
    expect(request.messages[0].content).toContain('continuous or dynamic response');
    expect(request.messages[0].content).not.toContain('visual.waterSurfaces');
    expect(request.messages[0].content).not.toContain('geometry.rotateX(-Math.PI / 2)');
  });

  it('streams one complete model response after planning the structure', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const generatedCode = 'export function createModel(THREE, params = {}) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(validDraftSpec) } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: generatedCode } }] }),
      });
    global.fetch = fetchMock as never;
    const events: any[] = [];

    await service.streamProceduralObjectBuild('一栋复杂的建筑', '建筑', 'stylized', undefined, event => events.push(event));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const codeRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(codeRequest.response_format).toBeUndefined();
    expect(codeRequest.messages[0].content).toContain('img2threejs editable procedural-draft');
    expect(events[0].type).toBe('stage');
    expect(events.some(event => event.type === 'stage' && event.stage === 'plan')).toBe(true);
    expect(events.at(-2).type).toBe('single');
    expect(events.at(-1).type).toBe('complete');
    const single = events.find(event => event.type === 'single');
    expect(single.result.generatedCode).toBe(generatedCode);
    expect(single.result.draftSpec.subject).toBe(validDraftSpec.subject);
  });

  it('retries a timed-out complete-model request and reports retry progress', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const generatedCode = 'export function createModel(THREE) { const group = new THREE.Group(); return group; }';
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'AbortError' });
    const fetchMock = jest.fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: generatedCode } }] }),
      });
    global.fetch = fetchMock as never;
    const progress: any[] = [];

    const result = await service.generateProceduralObjectFromPrompt(
      '一栋建筑', '建筑', 'stylized', undefined, event => progress.push(event),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.generatedCode).toBe(generatedCode);
    expect(result.generationMetrics.attempts).toBe(2);
    expect(progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'retry', label: '生成请求超时，正在重试' }),
    ]));
  });

  it('does not retry non-transient payment errors', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => 'Insufficient Balance',
    });
    global.fetch = fetchMock as never;

    await expect(service.generateProceduralObjectFromPrompt('一栋建筑', '建筑', 'stylized'))
      .rejects.toThrow('HTTP 402');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});
