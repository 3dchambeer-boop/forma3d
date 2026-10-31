/*
 * Ready parametric FormaCAD designs for working without a language model (offline).
 * Each one is a complete design: parameters with limits, model, measurable checks, print settings.
 */
(function (root) {
  'use strict';
  const P = (name, label_ar, value, unit, min, max) => ({ name, label_ar, value, unit, min, max });
  const STARTERS = [
    {
      key: 'headphone_hook', keywords: ['سماعة','سماعات','هيدفون','headphone','headset'], idea: 'علاقة سماعات رأس تُثبّت على حافة المكتب',
      design: {
        name_ar: 'علاقة سماعات مكتبية', summary_ar: 'مشبك على شكل C يُركّب على حافة المكتب بدون براغي، وذراع سفلي بحافة تمنع انزلاق السماعة.',
        requirements: ['The clamp opening shall equal the desk thickness (desk_t) within 0.1 mm.', 'Walls shall be at least 4 mm thick.'],
        parameters: [P('desk_t', 'سماكة المكتب', 25, 'mm', 10, 50), P('wall', 'سماكة الجدار', 5, 'mm', 4, 8), P('width', 'عرض العلاقة', 30, 'mm', 20, 60), P('clamp_depth', 'عمق المشبك', 45, 'mm', 30, 80), P('arm_len', 'طول الذراع', 55, 'mm', 30, 100), P('lip_h', 'ارتفاع الحافة', 15, 'mm', 8, 30)],
        model: { union: [{ name: 'top jaw', rounded_box: { size: ['width', 'clamp_depth', 'wall'], r: 3 }, translate: [0, 0, 'desk_t+wall'] }, { name: 'spine', rounded_box: { size: ['width', 'wall', 'desk_t+2*wall'], r: 2 } }, { name: 'bottom jaw', rounded_box: { size: ['width', 'clamp_depth*0.6', 'wall'], r: 3 } }, { name: 'arm', rounded_box: { size: ['width', 'arm_len+wall', 'wall'], r: 3 }, translate: [0, '-arm_len', 0] }, { name: 'lip', rounded_box: { size: ['width', 'wall', 'lip_h'], r: 2 }, translate: [0, '-arm_len', 0] }] },
        checks: [{ label_ar: 'فتحة المشبك = سماكة المكتب', type: 'gap', at: ['width/2', 'clamp_depth*0.3', 'wall+desk_t/2'], axis: 'z', expect: 'desk_t', tol: 0.1 }, { label_ar: 'سماكة العمود', type: 'wall', at: ['width/2', 'wall/2', 'wall+desk_t/2'], axis: 'y', expect: 'wall', tol: 0.1 }, { label_ar: 'الارتفاع الكلي', type: 'size', axis: 'z', expect: 'desk_t+2*wall', tol: 0.2 }, { label_ar: 'الحافة مادة صلبة', type: 'solid', at: ['width/2', '-arm_len+wall/2', 'wall/2'] }],
        print: { material: 'PETG', layer_height_mm: 0.2, infill_percent: 30, supports: false, orientation_ar: 'على الجانب حتى تكون الطبقات بطول المشبك', notes_ar: ['4 جدران للمتانة'] },
        assumptions_ar: ['سماكة المكتب 25 مم — غيّرها حسب مكتبك'],
      },
    },
    {
      key: 'arduino_case', keywords: ['اردوينو','أردوينو','arduino','بوردة','لوحة الكترونية'], idea: 'علبة لبوردة أردوينو أونو مع فتحات USB والكهرباء',
      design: {
        name_ar: 'علبة أردوينو أونو', summary_ar: 'علبة بقاعدة وأعمدة تثبيت في مواقع ثقوب البوردة الأصلية، وفتحتين لمنفذ USB ومقبس الكهرباء.',
        requirements: ['The cavity shall clear the 68.6 x 53.4 mm Uno board by gap on each side.', 'Standoffs shall match the Uno mounting holes.'],
        parameters: [P('pcb_x', 'طول البوردة', 68.6, 'mm', 60, 120), P('pcb_y', 'عرض البوردة', 53.4, 'mm', 40, 100), P('gap', 'الخلوص حول البوردة', 1, 'mm', 0.4, 3), P('wall', 'سماكة الجدار', 2.4, 'mm', 1.6, 4), P('floor', 'سماكة القاعدة', 2, 'mm', 1.6, 4), P('inner_h', 'الارتفاع الداخلي', 22, 'mm', 15, 50), P('standoff_h', 'ارتفاع الأعمدة', 5, 'mm', 3, 10)],
        model: { difference: [{ union: [{ name: 'hollow shell', difference: [{ name: 'shell', rounded_box: { size: ['pcb_x+2*gap+2*wall', 'pcb_y+2*gap+2*wall', 'floor+inner_h'], r: 4 } }, { name: 'cavity', rounded_box: { size: ['pcb_x+2*gap', 'pcb_y+2*gap', 'inner_h+1'], r: 2 }, translate: ['wall', 'wall', 'floor'] }] }, { name: 'standoffs', union: [{ cylinder: { d: 6, h: 'standoff_h+0.5' }, translate: ['wall+gap+14', 'wall+gap+2.5', 'floor-0.5'] }, { cylinder: { d: 6, h: 'standoff_h+0.5' }, translate: ['wall+gap+15.3', 'wall+gap+50.7', 'floor-0.5'] }, { cylinder: { d: 6, h: 'standoff_h+0.5' }, translate: ['wall+gap+66.1', 'wall+gap+7.6', 'floor-0.5'] }, { cylinder: { d: 6, h: 'standoff_h+0.5' }, translate: ['wall+gap+66.1', 'wall+gap+35.5', 'floor-0.5'] }] }] }, { name: 'usb port', box: { size: ['wall+2', 13, 11] }, translate: [-1, 'wall+gap+38-6.5', 'floor+standoff_h+1.6'] }, { name: 'power jack', box: { size: ['wall+2', 10, 12] }, translate: [-1, 'wall+gap+7.6-5', 'floor+standoff_h+1.6'] }, { name: 'screw holes', union: [{ cylinder: { d: 2.8, h: 'standoff_h+2' }, translate: ['wall+gap+14', 'wall+gap+2.5', 'floor'] }, { cylinder: { d: 2.8, h: 'standoff_h+2' }, translate: ['wall+gap+15.3', 'wall+gap+50.7', 'floor'] }, { cylinder: { d: 2.8, h: 'standoff_h+2' }, translate: ['wall+gap+66.1', 'wall+gap+7.6', 'floor'] }, { cylinder: { d: 2.8, h: 'standoff_h+2' }, translate: ['wall+gap+66.1', 'wall+gap+35.5', 'floor'] }] }] },
        checks: [{ label_ar: 'عرض التجويف الداخلي', type: 'gap', at: ['wall+gap+pcb_x/2', 'wall+gap+pcb_y/2', 'floor+inner_h-3'], axis: 'x', expect: 'pcb_x+2*gap', tol: 0.15 }, { label_ar: 'سماكة الجدار الجانبي', type: 'wall', at: ['wall/2', 'wall+gap+pcb_y/2-4', 'floor+inner_h-3'], axis: 'x', expect: 'wall', tol: 0.1 }, { label_ar: 'سماكة القاعدة', type: 'wall', at: ['wall+gap+pcb_x/2', 'wall+gap+pcb_y/2', 'floor/2'], axis: 'z', expect: 'floor', tol: 0.1 }, { label_ar: 'فتحة USB مفتوحة', type: 'empty', at: ['wall/2', 'wall+gap+38', 'floor+standoff_h+7'] }, { label_ar: 'الطول الكلي', type: 'size', axis: 'x', expect: 'pcb_x+2*gap+2*wall', tol: 0.2 }],
        print: { material: 'PLA', layer_height_mm: 0.2, infill_percent: 20, supports: false, orientation_ar: 'القاعدة على السطح', notes_ar: ['الفتحات الجانبية تُطبع كجسر قصير'] },
        assumptions_ar: ['مواقع الأعمدة حسب ثقوب Arduino Uno R3'],
      },
    },
    {
      key: 'hex_wrench', keywords: ['مفتاح ربط','مفتاح صامولة','صامولة','مفتاح','wrench','spanner'], idea: 'مفتاح ربط لصامولة M8',
      design: {
        name_ar: 'مفتاح صامولة M8', summary_ar: 'مفتاح مسطح برأس سداسي مغلق بمقاس 13 مم بين الأوجه مع خلوص 0.2 مم، وثقب تعليق في نهاية المقبض.',
        requirements: ['The hex opening shall be 13.2 mm across flats (M8 nut 13 mm + 0.2 mm clearance).'],
        parameters: [P('af', 'المقاس بين الأوجه', 13.2, 'mm', 5.5, 30), P('handle_l', 'طول المقبض', 110, 'mm', 60, 180), P('t', 'السماكة', 6, 'mm', 4, 12), P('head_d', 'قطر الرأس', 26, 'mm', 12, 50)],
        model: { difference: [{ union: [{ cylinder: { d: 'head_d', h: 't', segments: 72 } }, { rounded_box: { size: ['handle_l', 14, 't'], r: 5 }, translate: [0, -7, 0] }, { cylinder: { d: 16, h: 't', segments: 64 }, translate: ['handle_l', 0, 0] }] }, { cylinder: { d: 'af/cos(30)', h: 't+2', segments: 6 }, translate: [0, 0, -1] }, { cylinder: { d: 6, h: 't+2' }, translate: ['handle_l', 0, -1] }] },
        checks: [{ label_ar: 'المقاس بين أوجه السداسي', type: 'gap', at: [0, 0, 't/2'], axis: 'y', expect: 'af', tol: 0.1 }, { label_ar: 'سماكة المفتاح', type: 'wall', at: ['handle_l/2', 0, 't/2'], axis: 'z', expect: 't', tol: 0.1 }, { label_ar: 'ثقب التعليق مفتوح', type: 'empty', at: ['handle_l', 0, 't/2'] }],
        print: { material: 'PETG', layer_height_mm: 0.2, infill_percent: 60, supports: false, orientation_ar: 'مسطّح على السطح', notes_ar: ['5 جدران و60% ملء لتحمّل العزم'] },
        assumptions_ar: ['صامولة M8 قياسية ISO 4032 بمقاس 13 مم'],
      },
    },
    {
      key: 'cable_comb', keywords: ['كيبل','كيابل','سلك','اسلاك','أسلاك','cable','شاحن'], idea: 'مشط لترتيب كيابل الشحن على طرف الطاولة',
      design: {
        name_ar: 'مشط كيابل', summary_ar: 'قطعة بفتحات دائرية تمسك الكيابل بقطر 6.5 مم وتسمح بإدخالها من الأعلى.',
        requirements: ['Each slot shall hold a cable of diameter cable_d.'],
        parameters: [P('n', 'عدد الكيابل', 6, 'count', 2, 12), P('cable_d', 'قطر الكيبل', 6.5, 'mm', 3, 12), P('pitch', 'المسافة بين الكيابل', 10, 'mm', 8, 20), P('h', 'الارتفاع', 12, 'mm', 8, 25)],
        model: { difference: [{ rounded_box: { size: ['n*pitch+6', 14, 'h'], r: 3 } }, { linear_array: { count: 'n', step: ['pitch', 0, 0], child: { union: [{ cylinder: { d: 'cable_d', h: 16, segments: 48 }, rotate: [-90, 0, 0], translate: ['3+pitch/2', -1, 'h*0.45'] }, { box: { size: ['cable_d*0.75', 16, 'h'] }, translate: ['3+pitch/2-cable_d*0.375', -1, 'h*0.45'] }] } } }] },
        checks: [{ label_ar: 'قطر فتحة الكيبل', type: 'gap', at: ['3+pitch/2', 7, 'h*0.45'], axis: 'x', expect: 'cable_d', tol: 0.15 }, { label_ar: 'الطول الكلي', type: 'size', axis: 'x', expect: 'n*pitch+6', tol: 0.2 }],
        print: { material: 'PLA', layer_height_mm: 0.2, infill_percent: 25, supports: false, orientation_ar: 'القاعدة على السطح', notes_ar: [] },
        assumptions_ar: ['كيابل شحن عادية بقطر 6.5 مم'],
      },
    },
    {
      key: 'vase', keywords: ['مزهرية','فازة','زهرية','vase','اصيص','أصيص'], idea: 'مزهرية صغيرة بأضلاع بارزة للزينة',
      design: {
        name_ar: 'مزهرية بأضلاع', summary_ar: 'مزهرية مجوّفة بجدار 2 مم وقاعدة 2 مم وأضلاع رأسية بارزة.',
        requirements: ['Wall and floor shall be 2 mm thick.'],
        parameters: [P('h', 'الارتفاع', 120, 'mm', 60, 220), P('r', 'نصف قطر القاعدة', 35, 'mm', 20, 80), P('ribs', 'عدد الأضلاع', 12, 'count', 6, 24)],
        model: { difference: [{ union: [{ revolve: { profile: [[0, 0], ['r', 0], ['r*1.15', 'h*0.35'], ['r*0.7', 'h*0.8'], ['r*0.8', 'h'], [0, 'h']], segments: 72 } }, { polar_array: { count: 'ribs', child: { cylinder: { d: 5, h: 'h*0.7', segments: 16 }, translate: ['r*0.97', 0, 2] } } }] }, { revolve: { profile: [[0, 2], ['r-2', 2], ['r*1.15-2', 'h*0.35'], ['r*0.7-2', 'h*0.8'], ['r*0.8-2', 'h+1'], [0, 'h+1']], segments: 72 } }] },
        checks: [{ label_ar: 'سماكة القاعدة', type: 'wall', at: ['r*0.4', 0, 1], axis: 'z', expect: 2, tol: 0.1 }, { label_ar: 'الارتفاع', type: 'size', axis: 'z', expect: 'h', tol: 0.2 }, { label_ar: 'داخلها مجوّف', type: 'empty', at: [0, 0, 'h*0.5'] }],
        print: { material: 'PLA', layer_height_mm: 0.2, infill_percent: 15, supports: false, orientation_ar: 'الفوهة للأعلى', notes_ar: ['لا تحفظ الماء بدون طلاء داخلي'] },
        assumptions_ar: [],
      },
    },
    {
      key: 'phone_stand', engine: 'phone_stand', idea: 'حامل هاتف مكتبي بزاوية ميل',
      keywords: ['حامل هاتف', 'حامل جوال', 'حامل موبايل', 'حامل تلفون', 'ستاند', 'phone stand', 'phone holder'],
      design: {
        name_ar: 'حامل هاتف مكتبي', summary_ar: 'قاعدة وظهر مائل بزاوية قابلة للتعديل وحافة أمامية تمسك الهاتف، والمسافة بين الحافة والظهر تساوي سماكة الهاتف.',
        requirements: ['The slot between the lip and the back shall equal phone_thickness.', 'The back shall lean at tilt_angle from horizontal.'],
        parameters: [P('width', 'العرض', 80, 'mm', 50, 150), P('height', 'ارتفاع الظهر', 100, 'mm', 60, 160), P('tilt_angle', 'زاوية الميل عن الأفق', 65, 'deg', 45, 85), P('base_depth', 'عمق القاعدة', 80, 'mm', 50, 140), P('thickness', 'السماكة', 4, 'mm', 3, 8), P('lip_height', 'ارتفاع الحافة الأمامية', 12, 'mm', 6, 30), P('phone_thickness', 'سماكة الهاتف مع الكفر', 12, 'mm', 7, 20)],
        model: { union: [
          { name: 'base', rounded_box: { size: ['width', 'base_depth', 'thickness'], r: 3 } },
          { name: 'front lip', box: { size: ['width', 'thickness', 'lip_height+thickness'] } },
          { name: 'back', rounded_box: { size: ['width', 'thickness', 'height'], r: 2 }, rotate: ['-(90-tilt_angle)', 0, 0], translate: [0, 'thickness+phone_thickness', 'thickness-0.5'] },
        ] },
        checks: [{ label_ar: 'المسافة بين الحافة والظهر = سماكة الهاتف', type: 'gap', at: ['width/2', 'thickness+phone_thickness/2', 'thickness+0.25'], axis: 'y', expect: 'phone_thickness', tol: 0.5 }, { label_ar: 'سماكة الحافة الأمامية', type: 'wall', at: ['width/2', 'thickness/2', 'thickness+lip_height/2'], axis: 'y', expect: 'thickness', tol: 0.1 }, { label_ar: 'العرض', type: 'size', axis: 'x', expect: 'width', tol: 0.1 }],
        print: { material: 'PLA', layer_height_mm: 0.2, infill_percent: 20, supports: false, orientation_ar: 'القاعدة على السطح', notes_ar: ['الظهر المائل يُطبع بدون دعامات حتى ميل 45°'] },
        assumptions_ar: ['سماكة الهاتف مع الكفر 12 مم'],
      },
    },
    {
      key: 'open_box', engine: 'open_box', idea: 'علبة مفتوحة لتنظيم الأغراض',
      keywords: ['علبة', 'صندوق', 'منظم', 'منظّم', 'حاوية', 'درج', 'box', 'organizer', 'tray', 'bin'],
      design: {
        name_ar: 'علبة تنظيم مفتوحة', summary_ar: 'علبة بزوايا مدوّرة وجدران وقاعدة بسماكة محددة، مقاساتها الداخلية مضبوطة.',
        requirements: ['Inner length shall be length - 2*wall.', 'Floor shall be floor mm thick.'],
        parameters: [P('length', 'الطول', 120, 'mm', 30, 210), P('width', 'العرض', 80, 'mm', 30, 210), P('height', 'الارتفاع', 50, 'mm', 15, 200), P('wall', 'سماكة الجدار', 2, 'mm', 1.2, 5), P('floor', 'سماكة القاعدة', 2, 'mm', 1.2, 5)],
        model: { difference: [{ rounded_box: { size: ['length', 'width', 'height'], r: 4 } }, { rounded_box: { size: ['length-2*wall', 'width-2*wall', 'height'], r: 2.5 }, translate: ['wall', 'wall', 'floor'] }] },
        checks: [{ label_ar: 'الطول الداخلي', type: 'gap', at: ['length/2', 'width/2', 'height/2'], axis: 'x', expect: 'length-2*wall', tol: 0.1 }, { label_ar: 'العرض الداخلي', type: 'gap', at: ['length/2', 'width/2', 'height/2'], axis: 'y', expect: 'width-2*wall', tol: 0.1 }, { label_ar: 'سماكة الجدار', type: 'wall', at: ['wall/2', 'width/2', 'height/2'], axis: 'x', expect: 'wall', tol: 0.1 }, { label_ar: 'سماكة القاعدة', type: 'wall', at: ['length/2', 'width/2', 'floor/2'], axis: 'z', expect: 'floor', tol: 0.1 }, { label_ar: 'الارتفاع', type: 'size', axis: 'z', expect: 'height', tol: 0.1 }],
        print: { material: 'PLA', layer_height_mm: 0.2, infill_percent: 15, supports: false, orientation_ar: 'الفتحة للأعلى', notes_ar: [] },
        assumptions_ar: [],
      },
    },
    {
      key: 'l_bracket', engine: 'l_bracket', idea: 'زاوية تثبيت حرف L لرف',
      keywords: ['زاوية تثبيت', 'زاوية رف', 'كتيفة', 'حامل رف', 'bracket', 'angle bracket', 'shelf bracket'],
      design: {
        name_ar: 'زاوية تثبيت L', summary_ar: 'زاوية بساقين وثقبي براغي في كل ساق ودعامتين مثلثتين على الجانبين للتقوية.',
        requirements: ['Holes shall be hole_diameter for the chosen screw.', 'Legs shall be thickness mm thick.'],
        parameters: [P('width', 'العرض', 30, 'mm', 15, 80), P('leg_a', 'طول الساق الأفقية', 50, 'mm', 25, 150), P('leg_b', 'طول الساق العمودية', 50, 'mm', 25, 150), P('thickness', 'السماكة', 5, 'mm', 3, 10), P('hole_diameter', 'قطر ثقب البرغي', 4.5, 'mm', 3, 9)],
        model: { difference: [
          { union: [
            { name: 'horizontal leg', box: { size: ['width', 'leg_a', 'thickness'] } },
            { name: 'vertical leg', box: { size: ['width', 'thickness', 'leg_b'] } },
            { name: 'gusset left', extrude: { points: [[0, 0], ['min(leg_a,leg_b)*0.5', 0], [0, 'min(leg_a,leg_b)*0.5']], h: 4 }, rotate: [0, -90, 0], translate: [4, 'thickness-0.5', 'thickness-0.5'] },
            { name: 'gusset right', extrude: { points: [[0, 0], ['min(leg_a,leg_b)*0.5', 0], [0, 'min(leg_a,leg_b)*0.5']], h: 4 }, rotate: [0, -90, 0], translate: ['width', 'thickness-0.5', 'thickness-0.5'] },
          ] },
          { cylinder: { d: 'hole_diameter', h: 'thickness+2', segments: 48 }, translate: ['width/2', 'leg_a*0.55', -1] },
          { cylinder: { d: 'hole_diameter', h: 'thickness+2', segments: 48 }, translate: ['width/2', 'leg_a*0.85', -1] },
          { cylinder: { d: 'hole_diameter', h: 'thickness+2', segments: 48 }, rotate: [90, 0, 0], translate: ['width/2', 'thickness+1', 'leg_b*0.55'] },
          { cylinder: { d: 'hole_diameter', h: 'thickness+2', segments: 48 }, rotate: [90, 0, 0], translate: ['width/2', 'thickness+1', 'leg_b*0.85'] },
        ] },
        checks: [{ label_ar: 'قطر ثقب الساق الأفقية', type: 'gap', at: ['width/2', 'leg_a*0.85', 'thickness/2'], axis: 'x', expect: 'hole_diameter', tol: 0.15 }, { label_ar: 'قطر ثقب الساق العمودية', type: 'gap', at: ['width/2', 'thickness/2', 'leg_b*0.85'], axis: 'x', expect: 'hole_diameter', tol: 0.15 }, { label_ar: 'سماكة الساق', type: 'wall', at: ['width/2', 'leg_a*0.7', 'thickness/2'], axis: 'z', expect: 'thickness', tol: 0.1 }, { label_ar: 'طول الساق الأفقية', type: 'size', axis: 'y', expect: 'leg_a', tol: 0.1 }, { label_ar: 'طول الساق العمودية', type: 'size', axis: 'z', expect: 'leg_b', tol: 0.1 }],
        print: { material: 'PETG', layer_height_mm: 0.2, infill_percent: 50, supports: false, orientation_ar: 'على الجانب حتى تمر الطبقات عبر الزاوية', notes_ar: ['للأحمال الثقيلة استخدم زاوية معدنية'] },
        assumptions_ar: ['براغي M4 (ثقب 4.5 مم)'],
      },
    },
    {
      key: 'spacer', engine: 'spacer', idea: 'حلقة فاصل لبرغي',
      keywords: ['حلقة', 'فاصل', 'وردة', 'جلبة', 'spacer', 'washer', 'bushing'],
      design: {
        name_ar: 'حلقة فاصلة', summary_ar: 'أسطوانة مجوّفة بقطر داخلي يناسب البرغي وقطر خارجي وارتفاع محدد.',
        requirements: ['Inner diameter shall be inner_diameter within 0.1 mm.'],
        parameters: [P('outer_diameter', 'القطر الخارجي', 20, 'mm', 6, 120), P('inner_diameter', 'القطر الداخلي', 8.4, 'mm', 2, 100), P('height', 'الارتفاع', 10, 'mm', 1, 100)],
        model: { difference: [{ cylinder: { d: 'outer_diameter', h: 'height', segments: 96 } }, { cylinder: { d: 'inner_diameter', h: 'height+2', segments: 96 }, translate: [0, 0, -1] }] },
        checks: [{ label_ar: 'القطر الداخلي', type: 'gap', at: [0, 0, 'height/2'], axis: 'x', expect: 'inner_diameter', tol: 0.1 }, { label_ar: 'سماكة الجدار', type: 'wall', at: ['(outer_diameter+inner_diameter)/4', 0, 'height/2'], axis: 'x', expect: '(outer_diameter-inner_diameter)/2', tol: 0.1 }, { label_ar: 'الارتفاع', type: 'size', axis: 'z', expect: 'height', tol: 0.1 }],
        print: { material: 'PETG', layer_height_mm: 0.2, infill_percent: 100, supports: false, orientation_ar: 'مسطّحة على السطح', notes_ar: [] },
        assumptions_ar: ['برغي M8 (ثقب 8.4 مم)'],
      },
    },
    {
      key: 'wall_hook', engine: 'wall_hook', idea: 'علاقة جدارية تُثبّت ببرغيين',
      keywords: ['علاقة جدار', 'علّاقة جدار', 'علاقة للجدار', 'على الجدار', 'على الحائط', 'خطاف', 'شماعة', 'تعليق', 'wall hook', 'hanger'],
      design: {
        name_ar: 'علّاقة جدارية', summary_ar: 'لوح خلفي بثقبين للبراغي وذراع بحافة في نهايته تمنع سقوط الشيء المعلّق.',
        requirements: ['Screw holes shall be screw_diameter.', 'The arm shall reach reach mm from the wall.'],
        parameters: [P('width', 'العرض', 20, 'mm', 10, 60), P('plate_height', 'ارتفاع اللوح', 60, 'mm', 30, 150), P('thickness', 'السماكة', 5, 'mm', 3, 10), P('reach', 'بروز الذراع', 35, 'mm', 15, 100), P('tip_height', 'ارتفاع الحافة', 12, 'mm', 5, 40), P('screw_diameter', 'قطر ثقب البرغي', 4.5, 'mm', 3, 7)],
        model: { difference: [
          { union: [{ name: 'plate', box: { size: ['width', 'thickness', 'plate_height'] } }, { name: 'arm', box: { size: ['width', 'reach', 'thickness'] } }, { name: 'tip', box: { size: ['width', 'thickness', 'tip_height'] }, translate: [0, 'reach-thickness', 0] }] },
          { cylinder: { d: 'screw_diameter', h: 'thickness+2', segments: 48 }, rotate: [90, 0, 0], translate: ['width/2', 'thickness+1', 'plate_height*0.5'] },
          { cylinder: { d: 'screw_diameter', h: 'thickness+2', segments: 48 }, rotate: [90, 0, 0], translate: ['width/2', 'thickness+1', 'plate_height*0.85'] },
        ] },
        checks: [{ label_ar: 'قطر ثقب البرغي', type: 'gap', at: ['width/2', 'thickness/2', 'plate_height*0.85'], axis: 'x', expect: 'screw_diameter', tol: 0.15 }, { label_ar: 'سماكة اللوح', type: 'wall', at: ['width/2', 'thickness/2', 'plate_height*0.3'], axis: 'y', expect: 'thickness', tol: 0.1 }, { label_ar: 'بروز الذراع', type: 'size', axis: 'y', expect: 'reach', tol: 0.1 }, { label_ar: 'ارتفاع اللوح', type: 'size', axis: 'z', expect: 'plate_height', tol: 0.1 }],
        print: { material: 'PETG', layer_height_mm: 0.2, infill_percent: 40, supports: false, orientation_ar: 'على الجانب', notes_ar: [] },
        assumptions_ar: ['براغي M4'],
      },
    },
    {
      key: 'phone_case', idea: 'حافظة لآيفون 17 برو ماكس',
      keywords: ['حافظه', 'حافظة', 'كفر', 'جراب', 'غطاء موبايل', 'غطاء هاتف', 'cover', 'phone case', 'case'],
      design: {
        name_ar: 'حافظة آيفون 17 برو ماكس', summary_ar: 'حافظة بمقاس الهاتف الرسمي (163.4 × 78.0 × 8.75 مم من Apple) مع فتحة بعرض الظهر كاملًا لشريط الكاميرا، وحافة تمسك الشاشة، وفتحات للأزرار والشحن. تُطبع من TPU المرن.',
        requirements: ['Pocket shall be phone size + clearance on every side (Apple: 163.4 x 78.0 x 8.75 mm).', 'The camera opening shall span the full width of the back like the iPhone 17 Pro camera plateau.'],
        parameters: [P('phone_l', 'طول الهاتف', 163.4, 'mm', 100, 200), P('phone_w', 'عرض الهاتف', 78.0, 'mm', 50, 100), P('phone_t', 'سماكة الهاتف', 8.75, 'mm', 6, 14), P('corner_r', 'نصف قطر زوايا الهاتف', 12, 'mm', 4, 20), P('clear', 'الخلوص حول الهاتف', 0.25, 'mm', 0, 1), P('wall', 'سماكة الجوانب', 1.6, 'mm', 1.2, 3), P('back', 'سماكة الظهر', 1.6, 'mm', 1.2, 3), P('lip', 'بروز الحافة فوق الشاشة', 1.0, 'mm', 0.5, 2), P('cam_top', 'المسافة من أعلى الهاتف إلى شريط الكاميرا', 2.5, 'mm', 0, 20), P('cam_h', 'ارتفاع شريط الكاميرا', 45, 'mm', 20, 70), P('cam_side', 'هامش شريط الكاميرا من الجانبين', 2.5, 'mm', 0, 15), P('lb_from_top', 'بداية أزرار الجهة اليسرى من الأعلى', 28, 'mm', 5, 120), P('lb_len', 'طول فتحة الجهة اليسرى', 50, 'mm', 10, 100), P('rb_from_top', 'بداية أزرار الجهة اليمنى من الأعلى', 40, 'mm', 5, 120), P('rb_len', 'طول فتحة الجهة اليمنى', 75, 'mm', 10, 120)],
        model: { difference: [
          { name: 'shell', rounded_box: { size: ['phone_w+2*clear+2*wall', 'phone_l+2*clear+2*wall', 'back+phone_t+lip+0.2'], r: 'corner_r+wall' } },
          { name: 'phone pocket', rounded_box: { size: ['phone_w+2*clear', 'phone_l+2*clear', 'phone_t'], r: 'corner_r' }, translate: ['wall', 'wall', 'back'] },
          { name: 'screen opening', rounded_box: { size: ['phone_w+2*clear-2*lip', 'phone_l+2*clear-2*lip', 'lip+2'], r: 'corner_r-lip' }, translate: ['wall+lip', 'wall+lip', 'back+phone_t-0.5'] },
          { name: 'camera plateau (full width)', rounded_box: { size: ['phone_w+2*clear-2*cam_side', 'cam_h', 'back+2'], r: 'min(corner_r*0.7, cam_h/2-1)' }, translate: ['wall+cam_side', 'wall+phone_l+2*clear-cam_top-cam_h', -1] },
          { name: 'usb-c and speakers', rounded_box: { size: [40, 'wall+2', 'phone_t*0.7'], r: 1 }, translate: ['wall+clear+phone_w/2-20', -1, 'back+phone_t*0.15'] },
          { name: 'left buttons', box: { size: ['wall+2', 'lb_len', 'phone_t*0.7'] }, translate: [-1, 'wall+clear+phone_l-lb_from_top-lb_len', 'back+phone_t*0.15'] },
          { name: 'right buttons', box: { size: ['wall+2', 'rb_len', 'phone_t*0.7'] }, translate: ['wall+2*clear+phone_w-1', 'wall+clear+phone_l-rb_from_top-rb_len', 'back+phone_t*0.15'] },
        ] },
        checks: [
          { label_ar: 'عرض الجيب = عرض الهاتف + الخلوص', type: 'gap', at: ['wall+clear+phone_w/2', 'wall+20', 'back+phone_t/2'], axis: 'x', expect: 'phone_w+2*clear', tol: 0.1 },
          { label_ar: 'طول الجيب = طول الهاتف + الخلوص', type: 'gap', at: ['wall+clear+phone_w/2-25', 'wall+clear+phone_l/2', 'back+phone_t/2'], axis: 'y', expect: 'phone_l+2*clear', tol: 0.1 },
          { label_ar: 'سماكة الظهر', type: 'wall', at: ['wall+clear+phone_w/2', 'wall+clear+phone_l/2', 'back/2'], axis: 'z', expect: 'back', tol: 0.1 },
          { label_ar: 'فتحة الكاميرا مفتوحة', type: 'empty', at: ['wall+clear+phone_w/2', 'wall+2*clear+phone_l-cam_top-cam_h/2', 'back/2'] },
          { label_ar: 'ارتفاع فتحة الكاميرا', type: 'gap', at: ['wall+clear+phone_w/2', 'wall+2*clear+phone_l-cam_top-cam_h/2', 'back/2'], axis: 'y', expect: 'cam_h', tol: 0.1 },
          { label_ar: 'عرض فتحة الكاميرا (بعرض الظهر)', type: 'gap', at: ['wall+clear+phone_w/2', 'wall+2*clear+phone_l-cam_top-cam_h/2', 'back/2'], axis: 'x', expect: 'phone_w+2*clear-2*cam_side', tol: 0.1 },
          { label_ar: 'الحافة تمسك الشاشة', type: 'gap', at: ['wall+clear+phone_w/2', 'wall+20', 'back+phone_t+lip/2'], axis: 'x', expect: 'phone_w+2*clear-2*lip', tol: 0.1 },
        ],
        print: { material: 'TPU', layer_height_mm: 0.2, infill_percent: 100, supports: false, orientation_ar: 'الظهر على السطح', notes_ar: ['TPU مرن حتى تدخل الحافة فوق الشاشة', 'اطبع قطعة تجريبية للزاوية العليا أولًا وتأكد من شريط الكاميرا'] },
        assumptions_ar: ['أبعاد الهاتف الكلية من مواصفات Apple الرسمية: 163.4 × 78.0 × 8.75 مم.', 'ارتفاع شريط الكاميرا (45 مم) ونصف قطر الزوايا (12 مم) ومواقع الأزرار تقديرية من صور Apple — قِسها على هاتفك بالمسطرة وعدّلها قبل الطباعة.'],
      },
    },
  ];
  // ---------------------------------------------------------------- assemblies (several printed parts + constraints)
  const ASSEMBLIES = [
    {
      key: 'arduino_case_lid', name_ar: 'علبة أردوينو مع غطاء', summary_ar: 'العلبة الجاهزة مع غطاء بشفة تدخل في التجويف بخلوص 0.3 مم من كل جانب.',
      parts: [
        { id: 'case', name_ar: 'العلبة', design: STARTERS.find((x) => x.key === 'arduino_case').design },
        {
          id: 'lid', name_ar: 'الغطاء', translate: [0, 80, 0],
          datums: { underside: { axis: 'z', at: 3, dir: -1 } },
          design: {
            name_ar: 'غطاء علبة أردوينو', summary_ar: 'لوح بسماكة 2 مم وشفة سفلية تثبّته داخل التجويف.', requirements: ['The lip shall clear the case cavity by 0.3 mm on every side.'],
            parameters: [{ name: 'fit', label_ar: 'الخلوص حول الشفة', value: 0.3, unit: 'mm', min: 0.1, max: 0.8 }],
            model: { union: [
              { name: 'plate', rounded_box: { size: [74.4, 59.2, 2], r: 3.5 }, translate: [0.5, 0.5, 3] },
              { name: 'lip', rounded_box: { size: ['70.6-2*fit', '55.4-2*fit', 3.5], r: '2-fit' }, translate: ['2.4+fit', '2.4+fit', 0] },
            ] },
            checks: [], print: { material: 'PLA', layer_height_mm: 0.2, infill_percent: 20, supports: false, orientation_ar: 'اطبعه مقلوبًا: اللوح على السطح والشفة للأعلى.' },
          },
        },
      ],
      constraints: [
        { type: 'mate', a: 'case', a_face: '+z', b: 'lid', b_face: 'underside', offset: 0 },
        { type: 'align', a: 'case', b: 'lid', axis: 'x' },
        { type: 'align', a: 'case', b: 'lid', axis: 'y' },
        { type: 'clearance', a: 'case', b: 'lid', min: 0.25, ignore_contact: true },
      ],
    },
  ];
  const api = { STARTERS, ASSEMBLIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaStarters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
