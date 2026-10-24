// 喫茶ヌア（愛知県一宮市千秋町）の初期メニュー。管理画面の「メニュー」からすべて編集できます。
// ネット上（口コミ・ブログ）で確認できたのは次の値段だけです：
//   本日の珈琲 500円 / レモンスカッシュ 630円 / バスクチーズケーキ食べ比べ 850円 / ドリンク注文で50円引き
// それ以外の値段は仮の値で、商品の「スタッフ用メモ」に【要確認】と書いてあります。

const UNCONFIRMED = '【要確認】ネットで値段を確認できなかったため仮の値段です。実際の値段に直してください。';

// スコーンの種類（プレーン・胡桃は口コミで確認。日替わりは毎朝「本日の準備」で中身を入れる）
const sconeKinds = (id = 'kind') => ({
  id, name: 'スコーンの種類', type: 'single', required: true, hint: '日替わりの味は店内の黒板をご覧ください',
  choices: [
    { id: 'plain', label: 'プレーン', price: 0 },
    { id: 'walnut', label: '胡桃', price: 0 },
    { id: 'daily', label: '日替わり', slot: true, slotKey: '日替わりスコーン', detail: '', price: 0 },
  ],
});

// バスクチーズケーキの味（プレーン・ラムは口コミで確認。期間限定①②は黒板の枠）
const basqueFlavors = () => [
  { id: 'plain', label: 'プレーン', price: 0 },
  { id: 'rum', label: 'ラム', price: 0 },
  { id: 'l1', label: '期間限定①', slot: true, slotKey: 'バスク期間限定①', detail: '', price: 0 },
  { id: 'l2', label: '期間限定②', slot: true, slotKey: 'バスク期間限定②', detail: '', price: 0 },
];

// ドリンクと一緒に注文すると50円引き（口コミより）
const drinkDiscount = () => ({
  id: 'withdrink', name: 'ドリンクと一緒に', type: 'single', required: false, hint: 'ドリンクもご注文の方は50円引きです',
  choices: [{ id: 'yes', label: 'ドリンクも注文する（50円引き）', price: -50 }],
});

const hotIce = () => ({
  id: 'temp', name: 'ホット / アイス', type: 'single', required: true, hint: '',
  choices: [{ id: 'hot', label: 'ホット', price: 0 }, { id: 'ice', label: 'アイス', price: 0 }],
});

const morningDrink = () => ({
  id: 'drink', name: 'お飲み物', type: 'single', required: true, hint: '',
  choices: [
    { id: 'coffee-h', label: '本日の珈琲（ホット）', price: 0 },
    { id: 'coffee-i', label: '本日の珈琲（アイス）', price: 0 },
    { id: 'lemon', label: 'レモンスカッシュ', price: 130 },
  ],
});

export function seedData() {
  const categories = [
    { id: 'morning', name: 'モーニング・ブランチ' },
    { id: 'scone', name: 'スコーン' },
    { id: 'basque', name: 'バスクチーズケーキ' },
    { id: 'drink', name: 'ドリンク' },
    { id: 'goods', name: '焼き菓子' },
  ];

  const items = [
    {
      id: 'morning', categoryId: 'morning', name: 'スコーンモーニング', emoji: '🥐', price: 750, station: 'food',
      description: '平日 9:00〜12:00。スコーンとお飲み物のセット。', recommended: true, memo: UNCONFIRMED,
      availability: { days: [1, 2, 3, 4, 5], from: '09:00', to: '12:00' },
      optionGroups: [sconeKinds(), morningDrink()],
    },
    {
      id: 'brunch', categoryId: 'morning', name: '週末ブランチ', emoji: '🍽️', price: 1200, station: 'food',
      description: '土日祝 9:00〜12:00。', recommended: true,
      memo: `${UNCONFIRMED} 内容も未確認です。祝日は「本日の準備」でスコーンモーニングを「本日休み」にしてください。`,
      availability: { days: [0, 6], from: '09:00', to: '12:00' },
      optionGroups: [sconeKinds(), morningDrink()],
    },
    {
      id: 'scone', categoryId: 'scone', name: 'スコーン', emoji: '🥐', price: 380, station: 'food', daily: true, recommended: true,
      description: '看板のスコーン。プレーン・胡桃・日替わりから。', memo: UNCONFIRMED,
      optionGroups: [sconeKinds(), drinkDiscount()],
    },
    {
      id: 'scone-soup', categoryId: 'scone', name: 'スコーンとスープのセット', emoji: '🥣', price: 900, station: 'food', daily: true,
      description: 'スコーンとその日のスープ。', memo: UNCONFIRMED,
      optionGroups: [sconeKinds(), {
        id: 'soup', name: '本日のスープ', type: 'single', required: true, hint: 'スープの内容は黒板をご覧ください',
        choices: [{ id: 'today', label: '本日のスープ', slot: true, slotKey: '本日のスープ', detail: '', price: 0 }],
      }],
    },
    {
      id: 'basque', categoryId: 'basque', name: 'バスクチーズケーキ', emoji: '🍰', price: 500, station: 'food', daily: true, recommended: true,
      description: '定番のプレーン・ラムと、期間限定のフレーバー。', allergens: ['乳', '卵', '小麦'], memo: UNCONFIRMED,
      optionGroups: [
        { id: 'flavor', name: 'フレーバー', type: 'single', required: true, hint: '期間限定①②は店内の黒板をご覧ください', choices: basqueFlavors() },
        { id: 'finish', name: '仕上げ', type: 'single', required: false, hint: '', choices: [{ id: 'aburi', label: '炙り', price: 50 }] },
        drinkDiscount(),
      ],
    },
    {
      id: 'basque-pair', categoryId: 'basque', name: 'バスクチーズケーキ食べ比べ', emoji: '🍰', price: 850, station: 'food', daily: true,
      description: '好きな味を2種類選べます。', allergens: ['乳', '卵', '小麦'],
      optionGroups: [
        { id: 'flavors', name: '2種類を選ぶ', type: 'multi', required: true, min: 2, max: 2, hint: '期間限定①②は店内の黒板をご覧ください', choices: basqueFlavors() },
        drinkDiscount(),
      ],
    },
    {
      id: 'coffee', categoryId: 'drink', name: '本日の珈琲', emoji: '☕', price: 500, station: 'drink', ticketEligible: true,
      description: 'その日の豆で淹れる一杯。', optionGroups: [hotIce()],
    },
    { id: 'lemon', categoryId: 'drink', name: 'レモンスカッシュ', emoji: '🍋', price: 630, station: 'drink' },
    {
      id: 'yakigashi', categoryId: 'goods', name: '焼き菓子', emoji: '🍪', price: 300, station: 'other', customerVisible: false,
      description: 'レジ前で販売', memo: `${UNCONFIRMED} 種類ごとに分けて登録するのがおすすめです。`,
    },
  ];

  return { categories, items };
}

export function defaultSettings() {
  return {
    shopName: '喫茶ヌア',
    adminPin: '1234',
    timeZone: 'Asia/Tokyo',
    businessDayStartHour: 4,
    publicBaseUrl: '',
    tagCount: 10,
    seatCount: 12,
    orderingPaused: false,
    pauseMessage: 'ただいま注文を一時停止しています。少々お待ちください。',
    lastOrder: '',
    notice: '',
    welcome: 'ご来店ありがとうございます。スコーンとバスクチーズケーキのお店です。\n店内の撮影は、他のお客様が写らないようにお願いします（動画・長時間の撮影はご遠慮ください）。',
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
    paymentMethods: ['現金'],
    receipt: {
      address: '愛知県一宮市千秋町佐野下川田2931',
      phone: '',
      invoiceNumber: '',
      footer: 'またのご来店をお待ちしております',
    },
    newOrderSound: true,
  };
}
