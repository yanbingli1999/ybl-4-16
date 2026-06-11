const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const math = require('mathjs');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DATASETS_FILE = path.join(DATA_DIR, 'datasets.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATASETS_FILE)) {
    fs.writeFileSync(DATASETS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
  }
}
ensureDataFiles();

function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    return [];
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function linearRegression(points) {
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  points.forEach(p => {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  });
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { a: slope, b: intercept };
}

function exponentialRegression(points) {
  const invalidPoints = points.filter(p => p.y <= 0);
  if (invalidPoints.length > 0) {
    const indices = invalidPoints.map((_, i) => {
      const idx = points.indexOf(invalidPoints[i]) + 1;
      return `#${idx}(y=${invalidPoints[i].y})`;
    }).join(', ');
    throw new Error(`指数拟合要求所有Y值必须大于0，存在非法点: ${indices}`);
  }
  const n = points.length;
  const logPoints = points.map(p => ({ x: p.x, y: Math.log(p.y) }));
  const linearResult = linearRegression(logPoints);
  return { a: Math.exp(linearResult.b), b: linearResult.a };
}

function quadraticRegression(points) {
  const n = points.length;
  const rows = points.map(p => [p.x * p.x, p.x, 1]);
  const A = math.matrix(rows);
  const b = math.matrix(points.map(p => p.y));
  const AT = math.transpose(A);
  const ATA = math.multiply(AT, A);
  const ATb = math.multiply(AT, b);
  try {
    const ATAInv = math.inv(ATA);
    const x = math.multiply(ATAInv, ATb);
    const result = x.toArray();
    return { a: result[0], b: result[1], c: result[2] };
  } catch (e) {
    return { a: 0, b: 0, c: 0 };
  }
}

function calculateMetrics(points, modelType, params) {
  const n = points.length;
  let yMean = 0;
  points.forEach(p => yMean += p.y);
  yMean /= n;

  let ssTotal = 0;
  let ssResidual = 0;
  const residuals = [];
  let maeSum = 0;
  let rmseSum = 0;

  points.forEach(p => {
    let predicted;
    switch (modelType) {
      case 'linear':
        predicted = params.a * p.x + params.b;
        break;
      case 'exponential':
        predicted = params.a * Math.exp(params.b * p.x);
        break;
      case 'quadratic':
        predicted = params.a * p.x * p.x + params.b * p.x + params.c;
        break;
    }
    const residual = p.y - predicted;
    residuals.push(residual);
    ssResidual += residual * residual;
    ssTotal += (p.y - yMean) * (p.y - yMean);
    maeSum += Math.abs(residual);
    rmseSum += residual * residual;
  });

  const rSquared = 1 - (ssResidual / ssTotal);
  const mse = ssResidual / n;
  const rmse = Math.sqrt(rmseSum / n);
  const mae = maeSum / n;

  const residualStd = math.std(residuals);

  const outliers = residuals.map((r, i) => {
    const zScore = Math.abs(r - math.mean(residuals)) / residualStd;
    return { index: i, isOutlier: zScore > 2, zScore: zScore, residual: r };
  });

  return { rSquared, mse, rmse, mae, residuals, outliers };
}

function analyzeCurveFeatures(curvePoints, modelType, params) {
  if (!curvePoints || curvePoints.length < 5) {
    return { peaks: [], valleys: [], maxRiseInterval: null, inflectionPoints: [] };
  }

  const n = curvePoints.length;
  const firstDeriv = [];
  const secondDeriv = [];

  for (let i = 0; i < n; i++) {
    let d1;
    if (i === 0) {
      d1 = (curvePoints[i + 1].y - curvePoints[i].y) / (curvePoints[i + 1].x - curvePoints[i].x);
    } else if (i === n - 1) {
      d1 = (curvePoints[i].y - curvePoints[i - 1].y) / (curvePoints[i].x - curvePoints[i - 1].x);
    } else {
      const h = curvePoints[i + 1].x - curvePoints[i - 1].x;
      d1 = (curvePoints[i + 1].y - curvePoints[i - 1].y) / h;
    }
    firstDeriv.push(d1);
  }

  for (let i = 0; i < n; i++) {
    let d2;
    if (i === 0) {
      d2 = (firstDeriv[i + 1] - firstDeriv[i]) / (curvePoints[i + 1].x - curvePoints[i].x);
    } else if (i === n - 1) {
      d2 = (firstDeriv[i] - firstDeriv[i - 1]) / (curvePoints[i].x - curvePoints[i - 1].x);
    } else {
      const h = curvePoints[i + 1].x - curvePoints[i - 1].x;
      d2 = (firstDeriv[i + 1] - firstDeriv[i - 1]) / h;
    }
    secondDeriv.push(d2);
  }

  const ys = curvePoints.map(p => p.y);
  const yRange = Math.max(...ys) - Math.min(...ys) || 1;
  const peakThreshold = yRange * 0.02;
  const peaks = [];
  const valleys = [];

  for (let i = 1; i < n - 1; i++) {
    const prev = firstDeriv[i - 1];
    const curr = firstDeriv[i];
    const next = firstDeriv[i + 1];

    if (prev > 0 && next < 0) {
      const prominence = curvePoints[i].y - Math.min(
        curvePoints[Math.max(0, i - 5)].y,
        curvePoints[Math.min(n - 1, i + 5)].y
      );
      if (prominence >= peakThreshold) {
        peaks.push({
          id: 'peak_' + i,
          type: 'peak',
          x: curvePoints[i].x,
          y: curvePoints[i].y,
          confidence: Math.min(1, prominence / (yRange * 0.2)),
          basis: `一阶导数由正变负（${prev.toFixed(4)} → ${next.toFixed(4)}），局部显著性 ${prominence.toFixed(4)}`,
          confirmed: false
        });
      }
    }

    if (prev < 0 && next > 0) {
      const prominence = Math.max(
        curvePoints[Math.max(0, i - 5)].y,
        curvePoints[Math.min(n - 1, i + 5)].y
      ) - curvePoints[i].y;
      if (prominence >= peakThreshold) {
        valleys.push({
          id: 'valley_' + i,
          type: 'valley',
          x: curvePoints[i].x,
          y: curvePoints[i].y,
          confidence: Math.min(1, prominence / (yRange * 0.2)),
          basis: `一阶导数由负变正（${prev.toFixed(4)} → ${next.toFixed(4)}），局部显著性 ${prominence.toFixed(4)}`,
          confirmed: false
        });
      }
    }
  }

  let maxRiseInterval = null;
  if (n >= 2) {
    let maxSlope = -Infinity;
    let maxStart = 0;
    let maxEnd = 1;
    const windowSize = Math.max(2, Math.floor(n / 10));

    for (let i = 0; i < n - windowSize; i++) {
      const j = i + windowSize;
      const dx = curvePoints[j].x - curvePoints[i].x;
      if (dx === 0) continue;
      const slope = (curvePoints[j].y - curvePoints[i].y) / dx;
      if (slope > maxSlope) {
        maxSlope = slope;
        maxStart = i;
        maxEnd = j;
      }
    }

    if (maxSlope > 0) {
      maxRiseInterval = {
        id: 'maxrise_0',
        type: 'maxRiseInterval',
        startX: curvePoints[maxStart].x,
        startY: curvePoints[maxStart].y,
        endX: curvePoints[maxEnd].x,
        endY: curvePoints[maxEnd].y,
        slope: maxSlope,
        deltaY: curvePoints[maxEnd].y - curvePoints[maxStart].y,
        deltaX: curvePoints[maxEnd].x - curvePoints[maxStart].x,
        confidence: Math.min(1, maxSlope / (Math.abs(maxSlope) + yRange / (curvePoints[n - 1].x - curvePoints[0].x || 1))),
        basis: `区间 [${curvePoints[maxStart].x.toFixed(4)}, ${curvePoints[maxEnd].x.toFixed(4)}] 内平均斜率最大，为 ${maxSlope.toFixed(4)}，Y值变化 ${(curvePoints[maxEnd].y - curvePoints[maxStart].y).toFixed(4)}`,
        confirmed: false
      };
    }
  }

  const inflectionPoints = [];
  const inflectionThreshold = yRange * 0.005;
  for (let i = 1; i < n - 1; i++) {
    const prev = secondDeriv[i - 1];
    const curr = secondDeriv[i];
    const next = secondDeriv[i + 1];

    if ((prev > 0 && next < 0) || (prev < 0 && next > 0)) {
      const absChange = Math.abs(next - prev);
      if (absChange >= inflectionThreshold) {
        inflectionPoints.push({
          id: 'inflection_' + i,
          type: 'inflection',
          x: curvePoints[i].x,
          y: curvePoints[i].y,
          curvature: secondDeriv[i],
          confidence: Math.min(1, absChange / (yRange * 0.05)),
          basis: `二阶导数变号（${prev.toFixed(4)} → ${next.toFixed(4)}），凹凸性发生改变，曲率值 ${secondDeriv[i].toFixed(4)}`,
          confirmed: false
        });
      }
    }
  }

  if (modelType === 'quadratic' && params.a !== 0) {
    const vertexX = -params.b / (2 * params.a);
    const vertexY = params.a * vertexX * vertexX + params.b * vertexX + params.c;
    const xMin = curvePoints[0].x;
    const xMax = curvePoints[n - 1].x;

    if (vertexX >= xMin && vertexX <= xMax) {
      if (params.a < 0) {
        const exists = peaks.some(p => Math.abs(p.x - vertexX) < (xMax - xMin) * 0.02);
        if (!exists) {
          peaks.unshift({
            id: 'quad_vertex_peak',
            type: 'peak',
            x: vertexX,
            y: vertexY,
            confidence: 1.0,
            basis: `二次曲线顶点（解析解）：x = -b/(2a) = ${vertexX.toFixed(4)}，a < 0 故为最大值点`,
            confirmed: false
          });
        }
      } else {
        const exists = valleys.some(v => Math.abs(v.x - vertexX) < (xMax - xMin) * 0.02);
        if (!exists) {
          valleys.unshift({
            id: 'quad_vertex_valley',
            type: 'valley',
            x: vertexX,
            y: vertexY,
            confidence: 1.0,
            basis: `二次曲线顶点（解析解）：x = -b/(2a) = ${vertexX.toFixed(4)}，a > 0 故为最小值点`,
            confirmed: false
          });
        }
      }
    }
  }

  if (modelType === 'exponential') {
    if (inflectionPoints.length === 0 && n > 10) {
      const midIdx = Math.floor(n / 2);
      const midPoint = curvePoints[midIdx];
      const d1Mid = firstDeriv[midIdx];
      const d2Mid = secondDeriv[midIdx];
      if (Math.abs(d2Mid) > inflectionThreshold * 0.5) {
        inflectionPoints.push({
          id: 'exp_candidate',
          type: 'inflection',
          x: midPoint.x,
          y: midPoint.y,
          curvature: d2Mid,
          confidence: 0.5,
          basis: `指数模型候选拐点：位于区间中点附近，一阶导数 ${d1Mid.toFixed(4)}，二阶导数 ${d2Mid.toFixed(4)}`,
          confirmed: false
        });
      }
    }
  }

  return { peaks, valleys, maxRiseInterval, inflectionPoints };
}

function generateCurvePoints(points, modelType, params, numPoints = 100) {
  const xs = points.map(p => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const range = maxX - minX || 1;
  const extendedMin = minX - range * 0.1;
  const extendedMax = maxX + range * 0.1;
  const step = (extendedMax - extendedMin) / (numPoints - 1);
  const curvePoints = [];
  for (let i = 0; i < numPoints; i++) {
    const x = extendedMin + i * step;
    let y;
    switch (modelType) {
      case 'linear':
        y = params.a * x + params.b;
        break;
      case 'exponential':
        y = params.a * Math.exp(params.b * x);
        break;
      case 'quadratic':
        y = params.a * x * x + params.b * x + params.c;
        break;
    }
    curvePoints.push({ x, y });
  }
  return curvePoints;
}

app.get('/api/datasets', (req, res) => {
  const datasets = readJsonFile(DATASETS_FILE);
  res.json(datasets);
});

app.post('/api/datasets', (req, res) => {
  const { name, points } = req.body;
  if (!name || !points || !Array.isArray(points)) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  const datasets = readJsonFile(DATASETS_FILE);
  const dataset = {
    id: generateId(),
    name,
    points,
    createdAt: new Date().toISOString()
  };
  datasets.push(dataset);
  writeJsonFile(DATASETS_FILE, datasets);
  res.json(dataset);
});

app.put('/api/datasets/:id', (req, res) => {
  const { id } = req.params;
  const { name, points } = req.body;
  const datasets = readJsonFile(DATASETS_FILE);
  const index = datasets.findIndex(d => d.id === id);
  if (index === -1) {
    return res.status(404).json({ error: '数据集不存在' });
  }
  datasets[index].name = name || datasets[index].name;
  datasets[index].points = points || datasets[index].points;
  datasets[index].updatedAt = new Date().toISOString();
  writeJsonFile(DATASETS_FILE, datasets);
  res.json(datasets[index]);
});

app.delete('/api/datasets/:id', (req, res) => {
  const { id } = req.params;
  let datasets = readJsonFile(DATASETS_FILE);
  const initialLength = datasets.length;
  datasets = datasets.filter(d => d.id !== id);
  if (datasets.length === initialLength) {
    return res.status(404).json({ error: '数据集不存在' });
  }
  writeJsonFile(DATASETS_FILE, datasets);
  res.json({ success: true });
});

app.post('/api/fit', (req, res) => {
  const { datasetId, points, modelType, datasetName } = req.body;
  if (!points || !Array.isArray(points) || points.length < 2) {
    return res.status(400).json({ error: '至少需要2个数据点' });
  }
  if (!modelType) {
    return res.status(400).json({ error: '请选择拟合模型' });
  }

  let params;
  let modelEquation;

  try {
    switch (modelType) {
      case 'linear':
        params = linearRegression(points);
        modelEquation = `y = ${params.a.toFixed(6)}x + ${params.b.toFixed(6)}`;
        break;
      case 'exponential':
        params = exponentialRegression(points);
        modelEquation = `y = ${params.a.toFixed(6)} · e^(${params.b.toFixed(6)}x)`;
        break;
      case 'quadratic':
        params = quadraticRegression(points);
        modelEquation = `y = ${params.a.toFixed(6)}x² + ${params.b.toFixed(6)}x + ${params.c.toFixed(6)}`;
        break;
      default:
        return res.status(400).json({ error: '不支持的模型类型' });
    }
  } catch (e) {
    return res.status(400).json({ error: '拟合计算失败: ' + e.message });
  }

  const metrics = calculateMetrics(points, modelType, params);
  const curvePoints = generateCurvePoints(points, modelType, params);
  const features = analyzeCurveFeatures(curvePoints, modelType, params);

  const result = {
    id: generateId(),
    datasetId: datasetId || null,
    datasetName: datasetName || '未命名数据集',
    modelType,
    params,
    modelEquation,
    metrics: {
      rSquared: metrics.rSquared,
      mse: metrics.mse,
      rmse: metrics.rmse,
      mae: metrics.mae
    },
    residuals: metrics.residuals,
    outliers: metrics.outliers,
    curvePoints,
    points,
    features,
    createdAt: new Date().toISOString()
  };

  const history = readJsonFile(HISTORY_FILE);
  history.unshift(result);
  if (history.length > 50) {
    history.length = 50;
  }
  writeJsonFile(HISTORY_FILE, history);

  res.json(result);
});

app.get('/api/history', (req, res) => {
  const history = readJsonFile(HISTORY_FILE);
  const summaries = history.map(h => ({
    id: h.id,
    datasetId: h.datasetId,
    datasetName: h.datasetName,
    modelType: h.modelType,
    modelEquation: h.modelEquation,
    metrics: h.metrics,
    pointsCount: h.points.length,
    createdAt: h.createdAt
  }));
  res.json(summaries);
});

app.get('/api/history/:id', (req, res) => {
  const { id } = req.params;
  const history = readJsonFile(HISTORY_FILE);
  const result = history.find(h => h.id === id);
  if (!result) {
    return res.status(404).json({ error: '记录不存在' });
  }
  res.json(result);
});

app.delete('/api/history/:id', (req, res) => {
  const { id } = req.params;
  let history = readJsonFile(HISTORY_FILE);
  const initialLength = history.length;
  history = history.filter(h => h.id !== id);
  if (history.length === initialLength) {
    return res.status(404).json({ error: '记录不存在' });
  }
  writeJsonFile(HISTORY_FILE, history);
  res.json({ success: true });
});

app.put('/api/history/:id/features', (req, res) => {
  const { id } = req.params;
  const { features } = req.body;
  if (!features) {
    return res.status(400).json({ error: '缺少特征数据' });
  }
  const history = readJsonFile(HISTORY_FILE);
  const index = history.findIndex(h => h.id === id);
  if (index === -1) {
    return res.status(404).json({ error: '记录不存在' });
  }
  history[index].features = features;
  history[index].updatedAt = new Date().toISOString();
  writeJsonFile(HISTORY_FILE, history);
  res.json({ success: true, features: history[index].features });
});

app.listen(PORT, () => {
  console.log(`实验曲线拟合台 服务器已启动: http://localhost:${PORT}`);
});
