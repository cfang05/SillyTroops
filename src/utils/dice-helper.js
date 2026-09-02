// utils/dice-helper.js
// 骰子系统 - 服务于日常事件检定与战斗过程中的掷骰
// 支持 D4/D6/D8/D10/D12/D20 等所有标准骰子类型
// 支持战斗表达式（如 "1d20+5"）、优势/劣势、中文指令等多种格式
console.log('✅ Dice Helper 加载成功');

// ─────────────────────────────────────────────
//  DiceHelper 对象
// ─────────────────────────────────────────────
var DiceHelper = {

  // ── 测试方法 ──────────────────────────────
  test: function () {
    console.log('Dice Helper 测试方法调用');
    return 'Dice Helper 工作正常';
  },

  // ─────────────────────────────────────────
  /**
   * 解析并执行掷骰指令（核心方法）
   *
   * 支持的输入格式：
   *   - 基础骰：   "d20"  "2d6"  "d100"
   *   - 带修正值： "1d20+5"  "2d6-1"  "3d8+10"（战斗攻击/伤害常用）
   *   - 优势/劣势："d20优势"  "d20 adv"  "d20 advantage"
   *               "d20劣势"  "d20 dis"  "d20 disadvantage"
   *   - 中文前缀："投掷d20"  "掷骰2d6"
   *
   * 返回结构（战斗计算依赖此结构）：
   * {
   *   success:   boolean,  // 是否解析成功
   *   count:     number,   // 骰子数量（如 2d6 中的 2）
   *   sides:     number,   // 骰子面数（如 d20 中的 20）
   *   modifier:  number,   // 固定修正值（如 +5 或 -1），无则为 0
   *   rolls:     number[], // 每颗骰子的原始结果数组
   *   total:     number,   // 最终总点数 = sum(rolls) + modifier
   *   advantage: string|null, // "advantage" | "disadvantage" | null
   *   text:      string    // 人类可读的结果描述
   * }
   *
   * 示例（战斗场景）：
   *   parseDiceCommand("1d20+5")
   *   → { success:true, count:1, sides:20, modifier:5,
   *       rolls:[17], total:22, advantage:null,
   *       text:"1d20+5 = 22 [17] (17+5)" }
   *
   * @param {string} text - 掷骰指令字符串
   * @returns {Object|null} 掷骰结果对象，解析失败返回 null
   */
  parseDiceCommand: function (text) {
    console.log('🎲 解析掷骰指令:', text);

    // 参数校验
    if (!text || typeof text !== 'string') {
      console.log('无效的输入');
      return null;
    }

    // 清理输入：去除首尾空白、转小写
    var cleanText = text.trim().toLowerCase();

    // ── 正则匹配模式（优先级从高到低）─────────────────
    //
    // 注意：优势/劣势与修正值不能同时存在（语义冲突），
    // 因此分为两组独立模式。
    var patterns = [
      // ① 带修正值（战斗核心格式）：1d20+5 / 2d6-1 / d8+3
      //    捕获组：(数量)d(面数)(+/-修正)
      { pattern: /^(?:投掷|掷骰|roll)?\s*(\d+)?d(\d+)([+-]\d+)$/i, type: 'with_modifier' },

      // ② 优势/劣势（无修正值版本）：d20优势 / d20 adv
      //    捕获组：(数量)d(面数) (优劣关键词)
      { pattern: /^(?:投掷|掷骰|roll)?\s*(\d+)?d(\d+)\s*(优势|劣势|adv|dis|advantage|disadvantage)$/i, type: 'advantage' },

      // ③ 基础骰（无修正，无优劣势）：d20 / 2d6 / d100
      //    捕获组：(数量)d(面数)
      { pattern: /^(?:投掷|掷骰|roll)?\s*(\d+)?d(\d+)$/i, type: 'basic' }
    ];

    var match = null;
    var patternType = null;

    // 依序匹配，命中第一个即停止
    for (var i = 0; i < patterns.length; i++) {
      match = cleanText.match(patterns[i].pattern);
      if (match) {
        patternType = patterns[i].type;
        console.log('匹配到模式: ' + patternType, match);
        break;
      }
    }

    // 没有匹配到任何模式
    if (!match) {
      console.log('未匹配到任何掷骰格式');
      return null;
    }

    // ── 解析捕获组 ────────────────────────────────
    // count：骰子数量，省略时默认 1（如 "d20" → count=1）
    var count = match[1] ? parseInt(match[1], 10) : 1;
    // sides：骰子面数
    var sides = parseInt(match[2], 10);
    // 修正值与优势类型初始化
    var modifier = 0;
    var advantageType = null;

    if (patternType === 'with_modifier') {
      // match[3] 形如 "+5" 或 "-1"，parseInt 自动处理符号
      modifier = parseInt(match[3], 10);
    } else if (patternType === 'advantage') {
      // match[3] 为优劣势关键词
      var advKeyword = match[3].toLowerCase();
      if (advKeyword === '优势' || advKeyword === 'adv' || advKeyword === 'advantage') {
        advantageType = 'advantage';
      } else {
        advantageType = 'disadvantage';
      }
    }
    // patternType === 'basic'：modifier=0, advantageType=null，无需额外处理

    // ── 执行掷骰 ──────────────────────────────────
    var rolls = [];   // 每颗骰子的原始点数
    var total = 0;    // 最终合计（含修正值）

    if (advantageType === 'advantage') {
      // 优势：投掷两次，取较大值
      var r1 = this.rollSingleDie(sides);
      var r2 = this.rollSingleDie(sides);
      rolls = [r1, r2];
      total = Math.max(r1, r2) + modifier;
      console.log('优势掷骰:', { r1: r1, r2: r2, modifier: modifier, total: total });

    } else if (advantageType === 'disadvantage') {
      // 劣势：投掷两次，取较小值
      var r1 = this.rollSingleDie(sides);
      var r2 = this.rollSingleDie(sides);
      rolls = [r1, r2];
      total = Math.min(r1, r2) + modifier;
      console.log('劣势掷骰:', { r1: r1, r2: r2, modifier: modifier, total: total });

    } else {
      // 普通掷骰：投掷 count 次，全部累加
      for (var j = 0; j < count; j++) {
        var roll = this.rollSingleDie(sides);
        rolls.push(roll);
        total += roll;
      }
      // 加上修正值（modifier 为 0 时不影响结果）
      total += modifier;
      console.log('普通掷骰:', { rolls: rolls, modifier: modifier, total: total });
    }

    // ── 构建结果对象 ──────────────────────────────
    var result = {
      success: true,           // 解析成功标志
      count: count,            // 骰子数量
      sides: sides,            // 骰子面数
      modifier: modifier,      // 固定修正值（战斗计算使用）
      rolls: rolls,            // 原始点数数组（战斗计算使用）
      total: total,            // 最终总点数（战斗计算使用）
      advantage: advantageType, // null / "advantage" / "disadvantage"
      text: this.formatResultText(count, sides, modifier, rolls, total, advantageType)
    };

    console.log('掷骰结果:', result);
    return result;
  },

  // ─────────────────────────────────────────
  /**
   * 投掷单个骰子
   * 返回 [1, sides] 之间的随机整数（含两端）
   *
   * @param {number} sides - 骰子面数
   * @returns {number} 骰子点数
   */
  rollSingleDie: function (sides) {
    return Math.floor(Math.random() * sides) + 1;
  },

  // ─────────────────────────────────────────
  /**
   * 格式化掷骰结果为可读文本
   *
   * 输出样例：
   *   普通单骰（无修正）：   "d20 = 15 [15]"
   *   战斗攻击（带修正）：   "1d20+5 = 22 [17] (17+5)"
   *   多骰伤害（带修正）：   "2d6+3 = 11 [4, 4] (8+3)"
   *   优势（双骰取高）：     "d20 (优势) = 18 [12, 18] (取高)"
   *
   * @param {number}      count      - 骰子数量
   * @param {number}      sides      - 骰子面数
   * @param {number}      modifier   - 修正值
   * @param {number[]}    rolls      - 原始点数数组
   * @param {number}      total      - 最终合计
   * @param {string|null} advantage  - 优劣势类型
   * @returns {string} 格式化文本
   */
  formatResultText: function (count, sides, modifier, rolls, total, advantage) {
    var text = '';

    // ① 骰子表达式部分（如 "1d20+5" 或 "d6"）
    text = (count === 1 ? '1' : count) + 'd' + sides;

    if (modifier > 0) {
      text += '+' + modifier;
    } else if (modifier < 0) {
      text += modifier;  // 负号已包含在 modifier 数值中
    }

    // ② 优劣势标注
    if (advantage === 'advantage') {
      text += ' (优势)';
    } else if (advantage === 'disadvantage') {
      text += ' (劣势)';
    }

    // ③ 结果总计
    text += ' = ' + total;

    // ④ 原始骰子点数（方括号内）
    //    无论骰子数量是 1 还是多个，始终显示，方便战斗日志追溯
    if (advantage) {
      // 优劣势：显示两个骰子及取舍标注
      text += ' [' + rolls[0] + ', ' + rolls[1] + ']';
      text += advantage === 'advantage' ? ' (取高)' : ' (取低)';
    } else {
      // 普通：显示全部骰子点数
      text += ' [' + rolls.join(', ') + ']';
    }

    // ⑤ 修正值计算过程（仅当有修正时显示，帮助战斗中理解来源）
    if (modifier !== 0 && !advantage) {
      // 计算骰子点数之和（不含修正）
      var diceSum = 0;
      for (var i = 0; i < rolls.length; i++) {
        diceSum += rolls[i];
      }
      text += ' (' + diceSum + (modifier > 0 ? '+' : '') + modifier + ')';
    }

    return text;
  },

  // ─────────────────────────────────────────
  /**
   * 快速掷骰（直接按面数投掷，无需解析文本）
   * 适用于内部逻辑直接调用，跳过字符串解析步骤
   *
   * @param {number} sides    - 骰子面数（4/6/8/10/12/20/100）
   * @param {number} count    - 骰子数量（默认 1）
   * @param {number} modifier - 固定修正值（默认 0）
   * @returns {Object} 与 parseDiceCommand 相同结构的结果对象
   *
   * 示例（战斗伤害计算）：
   *   rollDice(6, 2, 3)  // 相当于 parseDiceCommand("2d6+3")
   */
  rollDice: function (sides, count, modifier) {
    count = count || 1;
    modifier = modifier || 0;

    var rolls = [];
    var total = modifier;

    for (var i = 0; i < count; i++) {
      var roll = this.rollSingleDie(sides);
      rolls.push(roll);
      total += roll;
    }

    return {
      success: true,
      count: count,
      sides: sides,
      modifier: modifier,
      rolls: rolls,
      total: total,
      advantage: null,
      text: this.formatResultText(count, sides, modifier, rolls, total, null)
    };
  },

  // ─────────────────────────────────────────
  /**
   * 检定结果描述
   * 根据最终点数在理论区间中的百分位返回描述文字
   * 适用于日常事件检定（探索/交涉/感知等）
   *
   * @param {Object} result - parseDiceCommand 或 rollDice 的返回值
   * @returns {string} 描述文字
   */
  getDiceDescription: function (result) {
    if (!result || !result.success) {
      return '🎲 掷骰失败';
    }

    var total = result.total;
    // 理论最大值与最小值（用于计算百分位）
    var maxPossible = result.sides * result.count + (result.modifier || 0);
    var minPossible = result.count + (result.modifier || 0);

    // 避免除零（骰子面数为1时）
    if (maxPossible === minPossible) return '📊 中等水平，中规中矩。';

    var percentage = (total - minPossible) / (maxPossible - minPossible);

    if (percentage >= 0.95) return '🎯 完美！不可思议的结果！';
    if (percentage >= 0.85) return '🌟 非凡！极其出色的表现！';
    if (percentage >= 0.75) return '👍 非常优秀！干得漂亮！';
    if (percentage >= 0.60) return '✅ 不错的结果，令人满意。';
    if (percentage >= 0.45) return '📊 中等水平，中规中矩。';
    if (percentage >= 0.30) return '🤔 还算可以，但不算出色。';
    if (percentage >= 0.15) return '😬 运气不太好，有点可惜。';
    if (percentage >= 0.05) return '⚠️ 糟糕的结果，下次会更好。';
    return '💥 惨不忍睹的失败...';
  },

  // ─────────────────────────────────────────
  /**
   * D20 临界判定（战斗专用）
   * 在 D20 检定中，自然 20 = 临界成功，自然 1 = 临界失败
   *
   * @param {Object} result - parseDiceCommand 或 rollDice 的返回值
   * @returns {string|null} "critical_success" | "critical_failure" | null
   *
   * 注意：临界判定仅看骰子原始点数，与修正值无关
   */
  checkCritical: function (result) {
    if (!result || !result.success || result.sides !== 20) return null;

    // 优势/劣势时取实际生效的那颗骰子点数
    var effectiveRoll;
    if (result.advantage === 'advantage') {
      effectiveRoll = Math.max(result.rolls[0], result.rolls[1]);
    } else if (result.advantage === 'disadvantage') {
      effectiveRoll = Math.min(result.rolls[0], result.rolls[1]);
    } else {
      // 单骰：rolls[0]；多骰 D20 不做临界判定（非标准用法）
      effectiveRoll = result.rolls[0];
    }

    if (effectiveRoll === 20) return 'critical_success';
    if (effectiveRoll === 1)  return 'critical_failure';
    return null;
  }
};

// 导出
export default DiceHelper;
