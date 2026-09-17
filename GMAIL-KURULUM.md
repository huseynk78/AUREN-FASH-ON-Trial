# Gmail bildirimleri

Gönderici: **highweartr@gmail.com**. Alıcı her siparişin formunda yazılan e-posta adresidir. Müşteri hesabı gerekmez.

1. Google hesabında iki adımlı doğrulamayı açın ve https://myaccount.google.com/apppasswords adresinden bir uygulama şifresi oluşturun. Normal hesap şifresi veya 6 haneli giriş kodu kullanılmaz.
2. Proje klasöründe PowerShell açıp `powershell -ExecutionPolicy Bypass -File .\setup-gmail.ps1` çalıştırın. Şifreyi gizli giriş alanına yapıştırın. Şifre yerel `.env` dosyasına kaydedilir; sohbetten paylaşmayın.
3. `npm install` ve `npm start` çalıştırın. Mevcut uygulama açıksa yeniden başlatın. Node.js 22.5 veya üzeri gerekir.
4. Sitede kendi alıcı adresinizle bir deneme siparişi oluşturun. Admin → Ayarlar altında gönderim durumunu kontrol edin. Ardından sipariş durumunu değiştirip ikinci e-postayı kontrol edin. Gelen kutusu ve spam klasörüne bakın.

Bu paketi mevcut projeye uygularken kendi `.env`, `data/` ve `uploads/` klasörlerinizi koruyun. ZIP şifre veya sipariş veritabanı içermez. Var olan admin şifresi değiştirilmez.

## Davranış

- Sipariş oluşturulunca ürünler, bedenler, adetler ve sipariş sırasında kaydedilen AZN/USD tutarlarıyla e-posta kuyruğa alınır.
- Her farklı durum değişikliğinde e-posta kuyruğa alınır. Aynı durumu tekrar seçmek yeni e-posta oluşturmaz. Bu değişiklik mevcut durum listesini değiştirmez.
- Sipariş kaydı ve e-posta olayı aynı veritabanı işlemi içinde saklanır. Gmail arızası siparişi geri almaz.
- Kuyruk 5 saniyede bir kontrol edilir. Hatalı gönderimler 1, 2, 4 ve 8 dakika sonra tekrar denenir; beş başarısız deneme sonunda admin tekrar denetebilir.
- Uygulama yeniden başlasa da bekleyen e-postalar korunur. Gmail'in mesajı kabul etmesi gelen kutusuna ulaştığı anlamına gelmez; panel bu durumu “Gmail qəbul etdi” olarak gösterir.
- Bağlantının belirsiz biçimde kopması veya gönderimden hemen sonra uygulamanın kapanması nadiren aynı mesajın tekrar gitmesine yol açabilir. SMTP kesin olarak bir kez teslim garantisi vermez.
- Eski `notifications` kayıtları otomatik gönderilmez. Yeni olaylar `email_outbox` tablosunda tutulur. E-posta adresi olmayan eski siparişlerin yeni bildirimleri `skipped` olur.
- `MAIL_ENABLED=false` gönderimi durdurur; yeni olayları saklamaya devam eder. Tekrar açınca birikmiş yeni olaylar gönderilir.
- İnternet erişimi ve Gmail SMTP portu 465'e çıkış gerekir. Barındırma hizmetiniz bu bağlantıyı engelliyorsa orada SMTP gönderimi çalışmaz.

## Testler

`npm test` gerçek e-posta göndermeden kuyruk, yeniden deneme, kalıcılık ve HTTP sipariş/durum akışlarını sınar. Gerçek Gmail bağlantısı, uygulama şifresi girildikten sonra yapılacak bir siparişle ayrıca doğrulanmalıdır.
