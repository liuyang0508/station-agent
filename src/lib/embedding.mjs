/**
 * 轻量级 embedding 生成模块
 * 使用词频统计生成伪向量，支持 cosine 相似度计算
 */

import pkg from 'ml-distance';
const { cosine } = pkg.similarity;

const DIM = 128; // 向量维度

/**
 * 将文本转换为特征向量
 * 使用词频哈希方法生成确定性向量
 */
export function textToVector(text) {
  const words = text.toLowerCase().split(/\s+/);
  const vector = new Float32Array(DIM);

  for (const word of words) {
    if (word.length < 2) continue;
    // 使用词哈希生成伪随机种子
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash;
    }
    // 使用 hash 种子生成随机向量分量
    const seed = Math.abs(hash);
    const rng = seedRandom(seed);
    for (let j = 0; j < DIM; j++) {
      vector[j] += rng();
    }
  }

  // L2 归一化
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
}

/**
 * 生成文本的 embedding 向量
 */
export async function generateEmbedding(text) {
  return textToVector(text);
}

/**
 * 计算两个向量的 cosine 相似度
 */
export function computeSimilarity(vec1, vec2) {
  return cosine(vec1, vec2);
}

/**
 * 简单的伪随机数生成器（确定性）
 */
function seedRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff);
  };
}