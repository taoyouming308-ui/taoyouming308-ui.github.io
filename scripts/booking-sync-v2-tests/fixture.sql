CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.bookings(id bigint PRIMARY KEY,shop_id text NOT NULL,shop_name text NOT NULL,barber_name text NOT NULL,barber_id text,customer_name text,customer_phone text,reservation_time bigint NOT NULL,time_label text,date text NOT NULL,status int DEFAULT 3,updated_at timestamptz DEFAULT now(),service_name text,notes text);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.bookings TO service_role;
INSERT INTO public.bookings(id,shop_id,shop_name,barber_name,reservation_time,date,notes) VALUES(1,'1009951','test','test',0,to_char(clock_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD'),'fixture');
