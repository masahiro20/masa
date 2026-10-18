// 初回起動時のサンプルデータ。管理画面の「メニュー」からすべて編集できます。

const hotIce = (id = 'temp') => ({
  id, name: 'ホット / アイス', type: 'single', required: true, hint: '',
  choices: [
    { id: 'hot', label: 'ホット', price: 0 },
    { id: 'ice', label: 'アイス', price: 0 },
  ],
});

const drinkSet = (prices = { blend: 300, latte: 400, tea: 300 }) => ({
  id: 'set', name: 'ドリンクセット', type: 'single', required: false, hint: 'セットにするとお得です',
  choices: [
    { id: 'blend-h', label: 'ブレンド（ホット）', price: prices.blend },
    { id: 'blend-i', label: 'ブレンド（アイス）', price: prices.blend },
    { id: 'latte', label: 'カフェラテ', price: prices.latte },
    { id: 'tea', label: '紅茶', price: prices.tea },
  ],
});

export function seedData() {
  const categories = [
    { id: 'coffee', name: 'コーヒー' },
    { id: 'drink', name: 'ティー・ドリンク' },
    { id: 'morning', name: 'モーニング' },
    { id: 'food', name: 'ブランチ・フード' },
    { id: 'sweets', name: 'スイーツ' },
    { id: 'goods', name: '物販・チケット' },
  ];

  const items = [
    {
      id: 'blend', categoryId: 'coffee', name: 'ブレンドコーヒー', emoji: '☕', price: 500,
      description: '当店定番。深めの焙煎でしっかりしたコク。', station: 'drink', ticketEligible: true,
      recommended: true, optionGroups: [hotIce()],
    },
    {
      id: 'dark', categoryId: 'coffee', name: '深煎りブレンド', emoji: '☕', price: 550,
      description: 'ビターで濃厚。ミルクとの相性も◎', station: 'drink', ticketEligible: true,
      optionGroups: [hotIce()],
    },
    {
      id: 'single', categoryId: 'coffee', name: '本日のシングルオリジン', emoji: '🫘', price: 650,
      description: '産地ごとの個性を楽しめるハンドドリップ。', station: 'drink', ticketEligible: true, daily: true,
      optionGroups: [{
        id: 'bean', name: '豆を選ぶ', type: 'single', required: true, hint: '本日の豆は店内の黒板をご覧ください',
        choices: [
          { id: 'b1', label: '①', slot: true, detail: '', price: 0 },
          { id: 'b2', label: '②', slot: true, detail: '', price: 0 },
        ],
      }],
    },
    {
      id: 'latte', categoryId: 'coffee', name: 'カフェラテ', emoji: '🥛', price: 600,
      description: 'コーヒーチケットご利用時は差額でお楽しみいただけます。', station: 'drink', ticketEligible: true,
      optionGroups: [hotIce(), {
        id: 'milk', name: 'ミルク変更', type: 'single', required: false, hint: '',
        choices: [{ id: 'oat', label: 'オーツミルク', price: 50 }, { id: 'soy', label: '豆乳', price: 50 }],
      }],
    },
    {
      id: 'tea', categoryId: 'drink', name: '紅茶', emoji: '🫖', price: 550, station: 'drink',
      description: 'ポットでご提供します。',
      optionGroups: [
        { id: 'leaf', name: '茶葉', type: 'single', required: true, hint: '', choices: [
          { id: 'darj', label: 'ダージリン', price: 0 }, { id: 'earl', label: 'アールグレイ', price: 0 }, { id: 'assam', label: 'アッサム（ミルクティー向き）', price: 0 },
        ] },
        { id: 'style', name: '飲み方', type: 'single', required: false, hint: '', choices: [
          { id: 'straight', label: 'ストレート', price: 0 }, { id: 'milk', label: 'ミルク', price: 0 }, { id: 'lemon', label: 'レモン', price: 0 },
        ] },
      ],
    },
    {
      id: 'soda', categoryId: 'drink', name: 'クリームソーダ', emoji: '🍈', price: 700, station: 'drink',
      description: '昔ながらの喫茶店の味。', recommended: true,
      optionGroups: [{ id: 'color', name: '色', type: 'single', required: true, hint: '', choices: [
        { id: 'melon', label: 'メロン', price: 0 }, { id: 'blue', label: 'ブルーハワイ', price: 0 }, { id: 'straw', label: 'いちご', price: 0 },
      ] }],
    },
    { id: 'orange', categoryId: 'drink', name: 'オレンジジュース', emoji: '🍊', price: 500, station: 'drink' },
    {
      id: 'morning', categoryId: 'morning', name: 'モーニングセット', emoji: '🍞', price: 750, station: 'food',
      description: 'トースト・ゆで卵・ドリンク付き（11:00まで）',
      availability: { days: [], from: '07:00', to: '11:00' },
      optionGroups: [
        { id: 'toast', name: 'トースト', type: 'single', required: true, hint: '', choices: [
          { id: 'butter', label: 'バタートースト', price: 0 }, { id: 'ogura', label: '小倉トースト', price: 50 },
        ] },
        { id: 'drink', name: 'お飲み物', type: 'single', required: true, hint: '', choices: [
          { id: 'blend-h', label: 'ブレンド（ホット）', price: 0 }, { id: 'blend-i', label: 'ブレンド（アイス）', price: 0 },
          { id: 'tea', label: '紅茶', price: 0 }, { id: 'latte', label: 'カフェラテ', price: 100 },
        ] },
      ],
    },
    {
      id: 'brunch', categoryId: 'food', name: '本日のブランチプレート', emoji: '🥗', price: 1300, station: 'food',
      description: 'サラダ・スープ・スコーン付き。スコーンはプレーンか日替わりから。', daily: true, recommended: true,
      availability: { days: [], from: '11:00', to: '15:00' },
      optionGroups: [
        { id: 'scone', name: 'スコーン', type: 'single', required: true, hint: '日替わりの味は黒板をご覧ください', choices: [
          { id: 'plain', label: 'プレーン', price: 0 }, { id: 'daily', label: '日替わり', slot: true, slotKey: '日替わりスコーン', detail: '', price: 0 },
        ] },
        drinkSet(),
      ],
    },
    {
      id: 'scone', categoryId: 'food', name: 'スコーン', emoji: '🥐', price: 380, station: 'food', daily: true,
      description: 'クロテッドクリーム・ジャム添え。',
      optionGroups: [
        { id: 'kind', name: '種類', type: 'single', required: true, hint: '', choices: [
          { id: 'plain', label: 'プレーン', price: 0 }, { id: 'daily', label: '日替わり', slot: true, slotKey: '日替わりスコーン', detail: '', price: 0 },
        ] },
      ],
    },
    {
      id: 'napolitan', categoryId: 'food', name: 'ナポリタン', emoji: '🍝', price: 950, station: 'food',
      description: '鉄板で焼き上げる昔ながらの味。',
      allergens: ['小麦', '乳', '卵'],
      optionGroups: [{ id: 'size', name: 'サイズ', type: 'single', required: false, hint: '', choices: [{ id: 'large', label: '大盛り', price: 150 }] }, drinkSet({ blend: 250, latte: 350, tea: 250 })],
    },
    {
      id: 'eggsand', categoryId: 'food', name: 'たまごサンド', emoji: '🥪', price: 800, station: 'food',
      allergens: ['小麦', '卵', '乳'], optionGroups: [drinkSet({ blend: 250, latte: 350, tea: 250 })],
    },
    {
      id: 'basque', categoryId: 'sweets', name: 'バスクチーズケーキ', emoji: '🍰', price: 550, station: 'food', daily: true,
      recommended: true, description: '定番のプレーンと、期間限定のフレーバー。',
      allergens: ['乳', '卵', '小麦'],
      optionGroups: [
        { id: 'flavor', name: 'フレーバー', type: 'single', required: true, hint: '期間限定①〜③は店内の黒板をご覧ください', choices: [
          { id: 'plain', label: 'プレーン', price: 0 },
          { id: 'l1', label: '期間限定①', slot: true, detail: '', price: 50 },
          { id: 'l2', label: '期間限定②', slot: true, detail: '', price: 50 },
          { id: 'l3', label: '期間限定③', slot: true, detail: '', price: 50, hidden: true },
        ] },
        drinkSet(),
      ],
    },
    {
      id: 'pudding', categoryId: 'sweets', name: '自家製かためプリン', emoji: '🍮', price: 480, station: 'food',
      allergens: ['乳', '卵'], stock: null, optionGroups: [drinkSet()],
    },
    {
      id: 'ticket11', categoryId: 'goods', name: 'コーヒーチケット（11枚綴り）', emoji: '🎫', price: 5000, station: 'other',
      customerVisible: false, description: 'レジでのみ販売',
    },
    {
      id: 'beans', categoryId: 'goods', name: 'コーヒー豆 200g', emoji: '🫘', price: 1500, station: 'other', customerVisible: false,
      optionGroups: [{ id: 'grind', name: '挽き方', type: 'single', required: true, hint: '', choices: [
        { id: 'bean', label: '豆のまま', price: 0 }, { id: 'paper', label: 'ペーパー用', price: 0 }, { id: 'press', label: 'フレンチプレス用', price: 0 },
      ] }],
    },
  ];

  return { categories, items };
}

export function defaultSettings() {
  return {
    shopName: '喫茶 ことり',
    adminPin: '1234',
    timeZone: 'Asia/Tokyo',
    businessDayStartHour: 4,
    publicBaseUrl: '',
    tagCount: 20,
    orderingPaused: false,
    pauseMessage: 'ただいま注文を一時停止しています。少々お待ちください。',
    lastOrder: '',
    notice: '',
    welcome: 'ご来店ありがとうございます。ごゆっくりお過ごしください。',
    requireStaffOpen: false,
    askPeople: true,
    callOptions: ['お冷やをください', '店員を呼ぶ', 'お会計をお願いします'],
    taxRate: 10,
    takeoutTaxRate: 8,
    ticket: { enabled: true, name: 'コーヒーチケット', value: 500 },
    discounts: [
      { id: 'd-stamp', name: 'スタンプカード満了', type: 'amount', value: 500 },
      { id: 'd-10', name: '10%OFF', type: 'percent', value: 10 },
      { id: 'd-100', name: '100円引き', type: 'amount', value: 100 },
    ],
    paymentMethods: ['現金', 'クレジットカード', 'QR決済', '交通系IC'],
    receipt: {
      address: '',
      phone: '',
      invoiceNumber: '',
      footer: 'またのご来店をお待ちしております',
    },
    newOrderSound: true,
  };
}
