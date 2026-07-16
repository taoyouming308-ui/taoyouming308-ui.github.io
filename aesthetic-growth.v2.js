(function(global) {
  'use strict';

  var VERSION = '2.0.0';
  var DIMENSIONS = [
    { id: 'human_analysis', name: '人物洞察' },
    { id: 'style', name: '风格理解' },
    { id: 'hair_anatomy', name: '结构解剖' },
    { id: 'suitability', name: '设计适配' },
    { id: 'client_communication', name: '沟通表达' }
  ];
  var MENTORS = [
    { id: 'aesthetic', name: '美学导师', avatar: '美', rule: '先看人物与比例，用可见证据推导，不急着命名风格。' },
    { id: 'technical', name: '技术导师', avatar: '技', rule: '把视觉结果拆成轮廓、重量、层次和可能的设计动作。' },
    { id: 'client', name: '顾客导师', avatar: '客', rule: '先理解顾客真正想改变什么，再把专业判断说成人能听懂的话。' },
    { id: 'devil', name: '反证导师', avatar: '辩', rule: '不接受只有结论的回答；必须找支持证据，也必须找一条反证。' },
    { id: 'master', name: '大师导师', avatar: '师', rule: '少说答案，只抓最影响人物与设计结果的底层关系。' }
  ];
  var CHALLENGES = [
    { id: 'person_only', name: '先看人，不看发型', instruction: '第一轮禁止使用任何风格名称，只分析人物与发型的比例关系。', focus: 'human_analysis' },
    { id: 'three_evidence', name: '三个证据', instruction: '任何结论都必须给出三个画面位置明确的视觉证据。', focus: 'style' },
    { id: 'find_counter', name: '寻找反证', instruction: '除了支持判断的证据，还要主动找一条不支持它的信号。', focus: 'style' },
    { id: 'change_one', name: '只改一个变量', instruction: '只允许改变一个设计变量，并说明人物效果会怎样变化。', focus: 'suitability' },
    { id: 'client_words', name: '不用术语', instruction: '把设计判断说成顾客听得懂的一句话，不能使用专业术语。', focus: 'client_communication' },
    { id: 'reverse_design', name: '失败倒推', instruction: '先找最可能失败的条件，再倒推设计必须调整什么。', focus: 'suitability' },
    { id: 'ai_may_be_wrong', name: '挑战导师', instruction: '导师会提出一个可疑判断；你要用视觉证据决定接受还是反驳。', focus: 'hair_anatomy' },
    { id: 'five_second', name: '五秒第一眼', instruction: '先说第一视觉重心，再解释它为什么比发型名称更重要。', focus: 'human_analysis' }
  ];
  var TAGS = {
    human_analysis: '比例观察者', style: '风格猎人', hair_anatomy: '结构解剖师',
    suitability: '设计转化者', client_communication: '顾客翻译官'
  };

  function hash(value) {
    var result = 0;
    value = String(value || '');
    for (var index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
    return Math.abs(result);
  }

  function normalizeProfile(profile) {
    profile = profile && typeof profile === 'object' ? profile : {};
    profile.version = VERSION;
    profile.dimensions = profile.dimensions || {};
    profile.mistakes = Array.isArray(profile.mistakes) ? profile.mistakes : [];
    profile.insightHistory = Array.isArray(profile.insightHistory) ? profile.insightHistory : [];
    profile.tags = Array.isArray(profile.tags) ? profile.tags : [];
    profile.sessions = Array.isArray(profile.sessions) ? profile.sessions : [];
    profile.masteryValue = Math.max(0, Number(profile.masteryValue) || 0);
    DIMENSIONS.forEach(function(item) {
      var row = profile.dimensions[item.id] || {};
      profile.dimensions[item.id] = {
        level: Math.max(0, Math.min(100, Number(row.level) || 0)),
        attempts: Math.max(0, Number(row.attempts) || 0),
        trend: Number(row.trend) || 0,
        lastEvidence: String(row.lastEvidence || '').slice(0, 180)
      };
    });
    return profile;
  }

  function weakestDimension(profile) {
    profile = normalizeProfile(profile);
    return DIMENSIONS.slice().sort(function(a, b) {
      var left = profile.dimensions[a.id];
      var right = profile.dimensions[b.id];
      return (left.level + Math.min(20, left.attempts)) - (right.level + Math.min(20, right.attempts));
    })[0];
  }

  function buildDailyPlan(input) {
    input = input || {};
    var profile = normalizeProfile(input.profile);
    var seed = hash(String(input.identity || '') + '|' + String(input.date || '') + '|' + String(input.caseKey || ''));
    var weak = weakestDimension(profile);
    var candidates = CHALLENGES.filter(function(item) { return item.focus === weak.id; });
    var challenge = candidates.length ? candidates[seed % candidates.length] : CHALLENGES[seed % CHALLENGES.length];
    var mentor = MENTORS[(seed + Math.max(0, Number(input.completedCount) || 0)) % MENTORS.length];
    var streak = Math.max(0, Number(input.streak) || 0);
    var boss = streak > 0 && streak % 7 === 0;
    if (boss) {
      mentor = MENTORS[3];
      challenge = { id: 'hidden_boss', name: '隐藏大师案例', instruction: '今天没有标准答案。找出最容易误判的三个地方，并用反证守住你的设计结论。', focus: weak.id };
    }
    return {
      version: VERSION,
      id: 'growth-' + String(input.date || '') + '-' + (seed % 100000),
      mentor: mentor,
      challenge: challenge,
      targetDimension: weak.id,
      targetLabel: weak.name,
      boss: boss,
      promise: '带走1个新知识、1个观察方法、1个沟通技巧',
      priorMistakes: profile.mistakes.slice(0, 8),
      priorInsights: profile.insightHistory.slice(-30)
    };
  }

  function applySession(profile, summary, checkpointStates, date) {
    profile = normalizeProfile(profile);
    summary = summary && typeof summary === 'object' ? summary : {};
    checkpointStates = checkpointStates && typeof checkpointStates === 'object' ? checkpointStates : {};
    DIMENSIONS.forEach(function(item) {
      var status = typeof checkpointStates[item.id] === 'string' ? checkpointStates[item.id] : checkpointStates[item.id] && checkpointStates[item.id].status;
      var row = profile.dimensions[item.id];
      var previous = row.level;
      var delta = status === 'mastered' || status === 'demonstrated' ? 6 : status === 'answered' ? 3 : 1;
      row.level = Math.min(100, Math.round((previous * Math.min(row.attempts, 8) + Math.min(100, previous + delta)) / (Math.min(row.attempts, 8) + 1)));
      row.attempts += 1;
      row.trend = row.level - previous;
      row.lastEvidence = String(summary.today_breakthrough || summary.unique_takeaway || '').slice(0, 180);
    });
    (summary.misconception_patterns || []).forEach(function(text) {
      text = String(text || '').trim().slice(0, 120);
      if (!text) return;
      var found = profile.mistakes.find(function(item) { return item.text === text; });
      if (found) { found.count += 1; found.lastSeen = date; }
      else profile.mistakes.push({ text: text, count: 1, lastSeen: date });
    });
    profile.mistakes.sort(function(a, b) { return b.count - a.count; });
    profile.mistakes = profile.mistakes.slice(0, 20);
    var insight = String(summary.golden_insight || summary.unique_takeaway || '').trim().slice(0, 240);
    if (insight && profile.insightHistory.indexOf(insight) === -1) profile.insightHistory.push(insight);
    profile.insightHistory = profile.insightHistory.slice(-100);
    var tag = String(summary.today_tag || TAGS[String(summary.strongest_dimension || '')] || '').trim().slice(0, 40);
    if (tag && !profile.tags.some(function(item) { return item.name === tag; })) profile.tags.push({ name: tag, earnedAt: date });
    profile.tags = profile.tags.slice(-50);
    profile.masteryValue += Math.max(1, Math.min(20, Number(summary.mastery_value) || 5));
    profile.sessions.push({ date: date, breakthrough: String(summary.today_breakthrough || ''), insight: insight, tag: tag });
    profile.sessions = profile.sessions.slice(-100);
    profile.updatedAt = new Date().toISOString();
    return profile;
  }

  function yesterdayComparison(profile) {
    profile = normalizeProfile(profile);
    if (profile.sessions.length < 2) return '这是成长基线；下一次会开始比较你的变化。';
    var latest = profile.sessions[profile.sessions.length - 1];
    var previous = profile.sessions[profile.sessions.length - 2];
    return latest.breakthrough && latest.breakthrough !== previous.breakthrough
      ? '上次：' + (previous.breakthrough || '建立基线') + '；这次：' + latest.breakthrough
      : '这次继续巩固同一盲点，下一次会换一个观察入口。';
  }

  global.AESTHETIC_GROWTH_V2 = {
    version: VERSION,
    dimensions: DIMENSIONS,
    mentors: MENTORS,
    challenges: CHALLENGES,
    normalizeProfile: normalizeProfile,
    weakestDimension: weakestDimension,
    buildDailyPlan: buildDailyPlan,
    applySession: applySession,
    yesterdayComparison: yesterdayComparison
  };
})(typeof window !== 'undefined' ? window : this);
