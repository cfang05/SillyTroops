// utils/storage.js - 统一的本地存储管理工具

/**
 * 存储键名常量
 * 集中管理所有本地存储的键名，避免硬编码和拼写错误
 */
const STORAGE_KEYS = {
  LLM_CONFIG: 'ai_model_settings'           // LLM 配置信息
};

/**
 * 获取存储的数据
 * @param {string} key - 存储键名
 * @returns {any|null} 返回存储的数据，失败返回 null
 */
function get(key) {
  try {
    const data = uni.getStorageSync(key);
    return data;
  } catch (error) {
    console.error(`[Storage] 读取失败 key="${key}":`, error);
    return null;
  }
}

/**
 * 保存数据到存储
 * @param {string} key - 存储键名
 * @param {any} data - 要保存的数据
 * @returns {boolean} 成功返回 true，失败返回 false
 */
function set(key, data) {
  try {
    uni.setStorageSync(key, data);
    return true;
  } catch (error) {
    console.error(`[Storage] 保存失败 key="${key}":`, error);
    return false;
  }
}

/**
 * 删除存储的数据
 * @param {string} key - 存储键名
 * @returns {boolean} 成功返回 true，失败返回 false
 */
function remove(key) {
  try {
    uni.removeStorageSync(key);
    return true;
  } catch (error) {
    console.error(`[Storage] 删除失败 key="${key}":`, error);
    return false;
  }
}

export default {
  STORAGE_KEYS,
  get,
  set,
  remove
};
