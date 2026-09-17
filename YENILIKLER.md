# Mağaza və admin yenilikləri

- Səbətdə hər məhsulun sətir məbləği və bütün səbətin AZN/USD yekunu göstərilir. Ədəd `+` / `−` düymələri və rəqəm sahəsi ilə dəyişdirilir.
- Qiymət və stok açıq səbətdə hər 5 saniyədə, səhifəyə qayıdanda və sifariş təsdiqlənəndə serverdən yoxlanılır. Artıq stok, gizlədilmiş və silinmiş məhsul barədə xəbərdarlıq göstərilir.
- Admin qiyməti dəyişdikdə səbətdə aktual məbləğ görünür. Son təsdiq zamanı qiymət yenidən dəyişərsə, yeni məbləği təsdiqləmək tələb olunur. Köhnə sifarişin qiyməti dəyişmir.
- Sifarişin təkrar göndərilməsi eyni səhifənin sifarişini ikinci dəfə yaratmır.
- Admin sifarişləri SSE bağlantısı ilə avtomatik yenilənir; bağlantı problemi üçün 15 saniyəlik ehtiyat yoxlama da var. Axtarış yazarkən və status seçərkən forma pozulmur.
- Aktiv, çatdırılmış və ləğv edilmiş sifarişlər ayrı bölmələrdədir. Status dəyişəndə sifariş uyğun bölməyə keçir. E-poçt bildirişləri işləməyə davam edir.
- Məhsullara qadın geyimi kateqoriyaları əlavə edildi. Admin məhsul formasında kateqoriya seçə, kateqoriya əlavə edə və adını dəyişə bilər. Mağazada kateqoriya filtri var. Mövcud məhsullar ilkin olaraq “Digər” kateqoriyasındadır; admin onları düzgün kateqoriyaya keçirə bilər.
- Adminin açıq məhsul formasında qiyməti yeniləməsi arada verilən sifarişlər nəticəsində azalmış stoku geri artırmır.
- İxrac həqiqi `.xlsx` faylıdır: sifariş xülasəsi və məhsul detalları, rəqəm formatında məbləğlər, sıfırla başlayan telefonların qorunması, tarixlər, filtrlər və dondurulmuş başlıqlar. Tarixlər UTC ilə işarələnir; ləğv edilmiş məbləğlər xülasədə ayrıca göstərilir.
- Admin, səbət və sifariş təsdiqi ekranları isti krem, qəhvəyi və bürünc çalarlarında yeniləndi. Mobil ekranlar ayrıca yoxlanıldı.

## İşə salma

Node.js 24 tövsiyə olunur. `npm install` və `npm start` işlədin. Mövcud `.env`, `data/` və `uploads/` saxlanmalıdır. Yeni verilənlər bazası sütunları başlanğıcda məlumatları silmədən əlavə olunur.

`npm test` ayrı müvəqqəti bazada sınaqlar aparır; real sifarişləri dəyişmir və e-poçt göndərmir. Server artıq işləyirsə, kod yenilənəndən sonra yenidən başladılmalıdır.

## Kod xəritəsi

- `server.js`: HTTP marşrutları, giriş və sessiyalar, şəkil idarəetməsi, ortaq HTML köməkçiləri.
- `shop-features.js`: aktual qiymət/stok hesabı, sifariş, kateqoriyalar, canlı admin bölmələri və uyğun baza dəyişiklikləri.
- `mail-service.js`: əvvəlki Gmail bildiriş növbəsi.
- `order-export.js`: `.xlsx` ixracı.
- `public/shop-ui.js`, `public/admin-live.js`, `public/product-editor.js`: müştəri və admin qarşılıqlı əlaqələri.
- `public/premium.css`: yenilənmiş üslub və mobil qaydalar.
